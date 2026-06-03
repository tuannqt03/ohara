import socket
import random
import threading
import time
from datetime import datetime

# ==================== CẤU HÌNH PLC GIẢ LẬP ====================
HOST = "0.0.0.0"
PORT = 8501
START_REGISTER = 2000
TOTAL_DEVICES = 78  # 3 biến môi trường + 25 máy * 3 biến


def build_fake_registers():
    """Tạo dữ liệu giả lập giống PLC thật: giá trị thực * 100."""

    # Môi trường ngoài trời = 0
    outdoor_temp = 0
    outdoor_humidity = 0

    values = [
        int(outdoor_temp * 100),
        int(outdoor_humidity * 100),
        0,  # Not_use_1
    ]

    # 25 máy, mỗi máy: env_temp, humidity, mold_temp
    for machine_id in range(1, 26):

        # Máy từ ID 16 đến 24 cho 0 hết
        if 16 <= machine_id <= 24:
            env_temp = 0
            humidity = 0
            mold_temp = 0

        else:
            env_temp = 26.0 + machine_id * 0.08 + random.uniform(-0.6, 0.6)
            humidity = 58.0 + random.uniform(-4.0, 4.0)

            # Nhiệt độ khuôn các máy = 0
            mold_temp = 0

        values.extend([
            int(env_temp * 100),
            int(humidity * 100),
            int(mold_temp * 100),
        ])

    return values[:TOTAL_DEVICES]


def parse_rds_command(command: str):
    """Parse lệnh dạng: RDS DM2000.U 78"""
    parts = command.strip().split()
    if len(parts) != 3 or parts[0].upper() != "RDS":
        return None

    device = parts[1].upper()
    count_text = parts[2]

    if not device.startswith(f"DM{START_REGISTER}.U"):
        return None

    try:
        count = int(count_text)
    except ValueError:
        return None

    return count


def handle_client(conn: socket.socket, addr):
    print(f"✅ Client kết nối: {addr}")
    buffer = ""

    try:
        while True:
            data = conn.recv(4096)
            if not data:
                break

            buffer += data.decode("ascii", errors="ignore")

            while "\r" in buffer or "\n" in buffer:
                split_positions = [p for p in [buffer.find("\r"), buffer.find("\n")] if p >= 0]
                pos = min(split_positions)
                command = buffer[:pos].strip()
                buffer = buffer[pos + 1:]

                if not command:
                    continue

                print(f"📩 Nhận lệnh: {command}")
                count = parse_rds_command(command)

                if count is None:
                    response = "E0\r"
                else:
                    values = build_fake_registers()[:count]
                    response = " ".join(str(v) for v in values) + "\r"

                conn.sendall(response.encode("ascii"))
                print(f"📤 Đã trả {count if count else 0} thanh ghi lúc {datetime.now().strftime('%H:%M:%S')}")

    except ConnectionResetError:
        pass
    except Exception as e:
        print(f"⚠️ Lỗi client {addr}: {e}")
    finally:
        conn.close()
        print(f"❌ Client ngắt kết nối: {addr}")


def main():
    print("=" * 60)
    print("PLC KEYENCE GIẢ LẬP - TCP SERVER")
    print("=" * 60)
    print(f"📡 Listen: {HOST}:{PORT}")
    print("📝 Hỗ trợ lệnh: RDS DM2000.U 78")
    print("⚙️ Outside Temp = 0, Outside Humidity = 0")
    print("⚙️ Mold Temp tất cả máy = 0")
    print("⚙️ Máy ID 16 đến 24 = 0 hết")
    print("⛔ Nhấn Ctrl+C để dừng")
    print("=" * 60)

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((HOST, PORT))
    server.listen(5)

    try:
        while True:
            conn, addr = server.accept()
            t = threading.Thread(target=handle_client, args=(conn, addr), daemon=True)
            t.start()
    except KeyboardInterrupt:
        print("\n✅ Dừng PLC giả lập")
    finally:
        server.close()


if __name__ == "__main__":
    main()