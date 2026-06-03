import socket
import sqlite3
import time
import os
import csv
from datetime import datetime
from typing import Optional, List, Dict, Any
from pathlib import Path

# ==================== CẤU HÌNH ĐƯỜNG DẪN DATABASE ====================
BASE_DIR = Path(__file__).resolve().parent
DB_DIR = BASE_DIR / "database"
MACHINE_DB_PATH = DB_DIR / "machine.db"

# ==================== CẤU HÌNH LƯU CSV THEO NGÀY ====================
CSV_ROOT_DIR = BASE_DIR / "csv_data"

# Tạo thư mục database nếu chưa tồn tại
DB_DIR.mkdir(exist_ok=True)

# ==================== CẤU HÌNH KẾT NỐI PLC ====================

PLC_IP = os.getenv("PLC_IP", "127.0.0.1")
PLC_PORT = int(os.getenv("PLC_PORT", "8501"))
PLC_TIMEOUT = 5

# Loại thanh ghi (theo Excel là DM)
DEVICE_TYPE = "DM"
DATA_FORMAT = ".U"  # Unsigned 16-bit integer
START_REGISTER = 2000  # Thanh ghi bắt đầu

# Thời gian đọc định kỳ (giây)
READ_INTERVAL = 10
# Thời gian retry kết nối khi mất (giây)
RETRY_INTERVAL = 5

# ==================== ĐỊNH NGHĨA CÁC BIẾN CẦN ĐỌC ====================
VARIABLES = [
    # Dữ liệu môi trường (machine_id = None)
    (0, "Outsite_Temperature", "°C", "outdoor_temp", None),
    (1, "Outsite_Humidity", "%", "outdoor_humidity", None),
    (2, "Not_use_1", "", "not_use", None),
]

# Tự động tạo danh sách biến cho 25 máy
for i in range(1, 26):
    offset_base = 3 + (i - 1) * 3
    VARIABLES.extend([
        (offset_base, f"M{i}_Sur_Temp", "°C", "env_temp", i),
        (offset_base + 1, f"M{i}_Sur_HD", "%", "humidity", i),
        (offset_base + 2, f"M{i}_Mold_Temp", "°C", "mold_temp", i),
    ])


def clear_screen():
    """Xóa màn hình console"""
    os.system('cls' if os.name == 'nt' else 'clear')


# ==================== LỚP KẾT NỐI PLC ====================
class KeyencePLC:
    def __init__(self, ip: str = "192.168.0.10", port: int = 8501, timeout: int = 5):
        self.ip = ip
        self.port = port
        self.timeout = timeout
        self.sock = None
        self.CR = "\r"
        self.connected = False

    def connect(self):
        """Kết nối đến PLC"""
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(self.timeout)
            self.sock.connect((self.ip, self.port))
            self.connected = True
            return True
        except Exception as e:
            self.connected = False
            return False

    def disconnect(self):
        """Ngắt kết nối"""
        if self.sock:
            try:
                self.sock.close()
            except:
                pass
            self.sock = None
        self.connected = False

    def _send_command(self, command: str) -> str:
        """Gửi command và nhận response"""
        if not self.connected:
            raise Exception("PLC not connected")

        full_command = command + self.CR
        self.sock.send(full_command.encode('ascii'))
        response = self.sock.recv(4096).decode('ascii').strip()
        return response

    def read_multiple_devices(self, device_type: str, device_no: str,
                              data_format: str, number_of_devices: int) -> Optional[List[str]]:
        """RDS - Read multiple devices"""
        try:
            command = f"RDS {device_type}{device_no}{data_format} {number_of_devices}"
            response = self._send_command(command)

            if response.startswith('E'):
                return None

            return response.split()
        except Exception as e:
            self.connected = False
            raise e


# ==================== LỚP QUẢN LÝ DATABASE ====================
class DatabaseManager:
    def __init__(self, db_path: str = MACHINE_DB_PATH):
        self.db_path = db_path

    def get_connection(self):
        """Tạo kết nối database"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    def check_database_ready(self) -> bool:
        """Kiểm tra database"""
        if not self.db_path.exists():
            return False

        try:
            with self.get_connection() as conn:
                tables = conn.execute("""
                    SELECT name FROM sqlite_master WHERE type = 'table';
                """).fetchall()
                table_names = {row["name"] for row in tables}

                required_tables = {"sensor_readings", "outdoor_weather_readings"}
                missing_tables = required_tables - table_names

                if missing_tables:
                    return False

            return True

        except Exception:
            return False

    def insert_sensor_reading(self, machine_id: int, mold_temp: float,
                              env_temp: float, humidity: float, recorded_at: str):
        """Lưu dữ liệu cảm biến"""
        with self.get_connection() as conn:
            conn.execute("""
                INSERT INTO sensor_readings (
                    machine_id, mold_temp, env_temp, humidity, recorded_at
                ) VALUES (?, ?, ?, ?, ?);
            """, (machine_id, mold_temp, env_temp, humidity, recorded_at))
            conn.commit()

    def insert_outdoor_weather(self, outdoor_temp: float, outdoor_humidity: float, recorded_at: str):
        """Lưu dữ liệu môi trường"""
        with self.get_connection() as conn:
            conn.execute("""
                INSERT INTO outdoor_weather_readings (
                    outdoor_temp, outdoor_humidity, recorded_at
                ) VALUES (?, ?, ?);
            """, (outdoor_temp, outdoor_humidity, recorded_at))
            conn.commit()


# ==================== LỚP LƯU CSV THEO NGÀY ====================
class CSVManager:
    def __init__(self, root_dir: Path = CSV_ROOT_DIR):
        self.root_dir = root_dir
        self.headers = [
            "recorded_at",
            "row_type",
            "machine_id",
            "outdoor_temp",
            "outdoor_humidity",
            "mold_temp",
            "env_temp",
            "humidity",
        ]

    def get_daily_file_path(self, timestamp: datetime) -> Path:
        """Tạo đường dẫn csv_data/Năm/Tháng/YYYY-MM-DD.csv"""
        year_dir = timestamp.strftime("%Y")
        month_dir = timestamp.strftime("%m")
        file_name = timestamp.strftime("%Y-%m-%d.csv")
        folder = self.root_dir / year_dir / month_dir
        folder.mkdir(parents=True, exist_ok=True)
        return folder / file_name

    def append_daily_rows(
            self,
            recorded_at: str,
            outdoor_temp: Optional[float],
            outdoor_humidity: Optional[float],
            machine_data: Dict[int, Dict[str, Optional[float]]],
    ) -> Path:
        """Ghi thêm dữ liệu vào file CSV của ngày hiện tại."""
        dt = datetime.strptime(recorded_at, "%Y-%m-%d %H:%M:%S")
        csv_path = self.get_daily_file_path(dt)
        file_exists = csv_path.exists()

        with open(csv_path, "a", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=self.headers)
            if not file_exists:
                writer.writeheader()

            # 1 dòng dữ liệu môi trường ngoài trời
            if outdoor_temp is not None or outdoor_humidity is not None:
                writer.writerow({
                    "recorded_at": recorded_at,
                    "row_type": "outdoor",
                    "machine_id": "",
                    "outdoor_temp": outdoor_temp,
                    "outdoor_humidity": outdoor_humidity,
                    "mold_temp": "",
                    "env_temp": "",
                    "humidity": "",
                })

            # Mỗi máy 1 dòng
            for machine_id in sorted(machine_data.keys()):
                values = machine_data[machine_id]
                writer.writerow({
                    "recorded_at": recorded_at,
                    "row_type": "machine",
                    "machine_id": machine_id,
                    "outdoor_temp": "",
                    "outdoor_humidity": "",
                    "mold_temp": values.get("mold_temp"),
                    "env_temp": values.get("env_temp"),
                    "humidity": values.get("humidity"),
                })

        return csv_path


# ==================== LỚP GIÁM SÁT PLC ====================
class PLCMonitor:
    def __init__(self, ip: str, port: int, timeout: int, device_type: str,
                 start_register: int, data_format: str):
        self.plc = KeyencePLC(ip, port, timeout)
        self.device_type = device_type
        self.start_register = start_register
        self.data_format = data_format
        self.number_of_devices = len(VARIABLES)
        self.db = DatabaseManager()
        self.csv = CSVManager()

    def ensure_connection(self) -> bool:
        """Đảm bảo kết nối với PLC, tự động retry nếu mất"""
        if not self.plc.connected:
            print("🔄 Đang thử kết nối lại PLC...")
            if self.plc.connect():
                print("✅ Kết nối PLC thành công")
                return True
            else:
                print(f"❌ Không thể kết nối PLC, thử lại sau {RETRY_INTERVAL} giây")
                return False
        return True

    def reconnect_with_retry(self):
        """Kết nối lại với retry"""
        self.plc.disconnect()
        while not self.plc.connect():
            print(f"⏱️  Chờ {RETRY_INTERVAL} giây để thử kết nối lại...")
            time.sleep(RETRY_INTERVAL)
        print("✅ Kết nối PLC thành công")

    def read_all_data(self) -> Optional[Dict[str, Any]]:
        """Đọc toàn bộ dữ liệu từ PLC"""
        if not self.ensure_connection():
            return None

        try:
            result = self.plc.read_multiple_devices(
                self.device_type,
                str(self.start_register),
                self.data_format,
                self.number_of_devices
            )

            if result is None:
                return None

            data_dict = {}
            for i, (offset, var_name, unit, db_field, machine_id) in enumerate(VARIABLES):
                if i < len(result):
                    try:
                        raw_value = int(result[i])
                        real_value = raw_value / 100.0
                        data_dict[var_name] = {
                            "raw": raw_value,
                            "value": real_value,
                            "db_field": db_field,
                            "machine_id": machine_id,
                        }
                    except ValueError:
                        data_dict[var_name] = {
                            "raw": result[i],
                            "value": None,
                            "db_field": db_field,
                            "machine_id": machine_id,
                        }

            return data_dict

        except Exception as e:
            print(f"⚠️ Lỗi đọc PLC: {str(e)}")
            self.plc.connected = False
            return None

    def save_to_database(self, data: Dict[str, Any]) -> tuple:
        """Lưu dữ liệu vào SQLite + CSV, trả về (số máy đã lưu, nhiệt độ môi trường, độ ẩm môi trường, csv_path)"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        # Lưu dữ liệu môi trường
        outdoor_temp = data.get("Outsite_Temperature", {}).get("value")
        outdoor_humidity = data.get("Outsite_Humidity", {}).get("value")

        if outdoor_temp is not None and outdoor_humidity is not None:
            try:
                self.db.insert_outdoor_weather(outdoor_temp, outdoor_humidity, timestamp)
            except Exception as e:
                print(f"⚠️ Lỗi lưu dữ liệu môi trường: {e}")

        # Lưu dữ liệu các máy
        machine_data = {}
        for var_name, info in data.items():
            if info["machine_id"] is not None and info["value"] is not None:
                machine_id = info["machine_id"]
                if machine_id not in machine_data:
                    machine_data[machine_id] = {}

                db_field = info["db_field"]
                machine_data[machine_id][db_field] = info["value"]

        # Insert vào database
        saved_count = 0
        for machine_id, values in machine_data.items():
            try:
                self.db.insert_sensor_reading(
                    machine_id=machine_id,
                    mold_temp=values.get("mold_temp"),
                    env_temp=values.get("env_temp"),
                    humidity=values.get("humidity"),
                    recorded_at=timestamp
                )
                saved_count += 1
            except Exception as e:
                print(f"⚠️ Lỗi lưu máy {machine_id}: {e}")

        # Ghi thêm CSV theo ngày hiện tại: csv_data/YYYY/MM/YYYY-MM-DD.csv
        csv_path = None
        try:
            csv_path = self.csv.append_daily_rows(
                recorded_at=timestamp,
                outdoor_temp=outdoor_temp,
                outdoor_humidity=outdoor_humidity,
                machine_data=machine_data,
            )
        except Exception as e:
            print(f"⚠️ Lỗi lưu CSV: {e}")

        return (saved_count, outdoor_temp, outdoor_humidity, csv_path)


# ==================== HÀM CHÍNH ====================
def main():
    # Xóa màn hình lần đầu
    clear_screen()

    print("=" * 60)
    print("GIÁM SÁT PLC KEYENCE -> SQLITE (Auto Reconnect)")
    print("=" * 60)

    print(f"\n📡 PLC: {PLC_IP}:{PLC_PORT}")
    print(f"📝 Thanh ghi: {DEVICE_TYPE}{START_REGISTER} ({len(VARIABLES)} thanh ghi)")
    print(f"⏱️  Chu kỳ đọc: {READ_INTERVAL}s")
    print(f"🔄 Retry kết nối: mỗi {RETRY_INTERVAL}s")
    print(f"💾 Database: {MACHINE_DB_PATH}")
    print("\n" + "=" * 60)

    monitor = PLCMonitor(
        ip=PLC_IP,
        port=PLC_PORT,
        timeout=PLC_TIMEOUT,
        device_type=DEVICE_TYPE,
        start_register=START_REGISTER,
        data_format=DATA_FORMAT
    )

    # Kiểm tra database
    if not monitor.db.check_database_ready():
        print("\n❌ Database chưa sẵn sàng. Thoát chương trình.")
        return

    # Kết nối PLC lần đầu
    print("\n🔄 Đang kết nối PLC...")
    monitor.reconnect_with_retry()

    cycle = 0
    consecutive_errors = 0

    try:
        while True:
            cycle += 1

            # Xóa màn hình trước mỗi lần đọc ghi
            clear_screen()

            # Hiển thị header
            print("=" * 60)
            print(f"GIÁM SÁT PLC KEYENCE -> SQLITE [Lần {cycle}]")
            print("=" * 60)
            print(f"⏰ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            print(f"🔌 Trạng thái PLC: {'✅ Đã kết nối' if monitor.plc.connected else '❌ Mất kết nối'}")
            print("-" * 60)

            # Đọc dữ liệu từ PLC
            data = monitor.read_all_data()

            if data:
                # Lưu vào SQLite
                machine_count, outdoor_temp, outdoor_humidity, csv_path = monitor.save_to_database(data)

                # Hiển thị kết quả
                print(f"✅ Đọc dữ liệu thành công")
                if outdoor_temp:
                    print(f"🌡️  Nhiệt độ môi trường: {outdoor_temp:.1f}°C")
                    print(f"💧 Độ ẩm môi trường: {outdoor_humidity:.1f}%")
                print(f"🏭 Số máy đã ghi: {machine_count}")
                print(f"💾 Đã lưu vào SQLite")
                if csv_path:
                    print(f"📄 Đã lưu CSV: {csv_path}")
                consecutive_errors = 0
            else:
                # Hiển thị lỗi
                consecutive_errors += 1
                print("❌ Lỗi: Không đọc được dữ liệu từ PLC")

                # Nếu mất kết nối, thử kết nối lại
                if not monitor.plc.connected:
                    print("🔄 Mất kết nối PLC, đang thử kết nối lại...")
                    monitor.reconnect_with_retry()

            print("-" * 60)
            print(f"⏱️  Chờ {READ_INTERVAL} giây đến lần đọc tiếp...")
            print("   Nhấn Ctrl+C để dừng")

            time.sleep(READ_INTERVAL)

    except KeyboardInterrupt:
        print("\n\n✅ Dừng chương trình")
    except Exception as e:
        print(f"\n❌ Lỗi nghiêm trọng: {e}")
    finally:
        monitor.plc.disconnect()
        print("👋 Đã ngắt kết nối PLC")


if __name__ == "__main__":
    main()