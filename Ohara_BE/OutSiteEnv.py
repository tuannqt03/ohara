import socket
import time
import os
from datetime import datetime
import logging
from pyModbusTCP.client import ModbusClient

# ==================== CẤU HÌNH KẾT NỐI PLC KEYENCE ====================
PLC_IP = "192.168.0.130"
PLC_PORT = 8501
PLC_TIMEOUT = 5

# ==================== CẤU HÌNH THANH GHI PLC ====================
DEVICE_TYPE = "DM"      # Loại thanh ghi
DATA_FORMAT = ".U"      # Định dạng dữ liệu (.U: unsigned 16-bit)
START_REGISTER = 2000   # Thanh ghi bắt đầu cho nhiệt độ
# Thanh ghi độ ẩm = START_REGISTER + 1

# ==================== CẤU HÌNH MODBUS TCP ====================
MODBUS_SERVER_IP = "192.168.0.100"
MODBUS_SERVER_PORT = 6000
UNIT_ID = 4

# QModMaster: Start Address = 1, Base Addr = 1 => raw = 0
REGISTER_ADDRESS_RAW = 0
DISPLAY_BASE_ADDRESS = 1
REGISTER_COUNT = 2

# Định dạng dữ liệu Modbus
DATA_FORMAT_MODBUS = "unsigned_16bit"  # unsigned_16bit, signed_16bit, unsigned_32bit, signed_32bit
WORD_ORDER_32BIT = "little"

# ==================== CẤU HÌNH THỜI GIAN ====================
READ_INTERVAL = 2       # Đọc dữ liệu từ Modbus mỗi 2 giây
WRITE_INTERVAL = 5      # Ghi vào PLC mỗi 5 giây
RETRY_INTERVAL = 5      # Retry khi mất kết nối

# ==================== CẤU HÌNH LOGGING ====================
ENABLE_LOGGING = True

if ENABLE_LOGGING:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s"
    )
    logger = logging.getLogger("ModbusToPLC")
else:
    logger = None

def log(message, level="info"):
    if ENABLE_LOGGING and logger:
        if level == "error":
            logger.error(message)
        else:
            logger.info(message)

def clear_screen():
    """Xóa màn hình console"""
    os.system('cls' if os.name == 'nt' else 'clear')

# ==================== LỚP KẾT NỐI PLC KEYENCE ====================
class KeyencePLC:
    def __init__(self, ip: str = PLC_IP, port: int = PLC_PORT, timeout: int = PLC_TIMEOUT):
        self.ip = ip
        self.port = port
        self.timeout = timeout
        self.sock = None
        self.CR = "\r"
        self.connected = False
        
    def connect(self) -> bool:
        """Kết nối đến PLC"""
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(self.timeout)
            self.sock.connect((self.ip, self.port))
            self.connected = True
            print(f"✅ Đã kết nối đến PLC Keyence {self.ip}:{self.port}")
            return True
        except Exception as e:
            print(f"❌ Kết nối PLC thất bại: {e}")
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
    
    def write_single_device(self, device_no: str, value: int) -> bool:
        """Ghi một giá trị vào một thanh ghi (0-65535)"""
        try:
            if value < 0 or value > 65535:
                print(f"⚠️ Giá trị {value} ngoài phạm vi 0-65535, sẽ clamp lại")
                value = max(0, min(65535, value))
            
            command = f"WR {DEVICE_TYPE}{device_no}{DATA_FORMAT} {value}"
            response = self._send_command(command)
            
            if response.startswith('E'):
                print(f"❌ Lỗi ghi PLC: {response}")
                return False
            return True
            
        except Exception as e:
            print(f"❌ Ngoại lệ khi ghi PLC: {e}")
            self.connected = False
            raise e

# ==================== HÀM XỬ LÝ MODBUS ====================
def convert_to_signed_16bit(value):
    """Convert unsigned 16-bit sang signed 16-bit"""
    if value >= 0x8000:
        return value - 0x10000
    return value

def combine_to_32bit(registers, word_order="little", signed=False):
    """Ghép 2 thanh ghi 16-bit thành 32-bit"""
    if len(registers) < 2:
        raise ValueError("Cần ít nhất 2 thanh ghi để ghép 32-bit")
    
    if word_order == "big":
        high_word = registers[0]
        low_word = registers[1]
    else:
        low_word = registers[0]
        high_word = registers[1]
    
    value = (high_word << 16) | low_word
    
    if signed and value >= 0x80000000:
        value -= 0x100000000
    
    return value

def process_modbus_data(registers):
    """
    Xử lý dữ liệu Modbus đọc được
    Trả về: (temperature_value, humidity_value) đã được scale phù hợp để ghi vào PLC
    Mặc định: register[0] = nhiệt độ, register[1] = độ ẩm
    """
    if registers is None or len(registers) < 2:
        return None, None
    
    temp_raw = registers[0]
    humidity_raw = registers[1]
    
    # Xử lý theo định dạng dữ liệu
    if DATA_FORMAT_MODBUS == "signed_16bit":
        temp_raw = convert_to_signed_16bit(temp_raw)
        humidity_raw = convert_to_signed_16bit(humidity_raw)
    elif DATA_FORMAT_MODBUS in ["unsigned_32bit", "signed_32bit"]:
        signed_32 = (DATA_FORMAT_MODBUS == "signed_32bit")
        temp_raw = combine_to_32bit(registers[:2], WORD_ORDER_32BIT, signed_32)
        # Nếu có 4 thanh ghi thì xử lý thêm, nhưng hiện tại mặc định 2 thanh ghi
    
    # Chuyển đổi giá trị thực tế sang giá trị ghi vào PLC (nhân với 100 nếu cần)
    # Ví dụ: nhiệt độ 25.5°C -> 2550, độ ẩm 65.0% -> 6500
    temperature_value = int(temp_raw * 100) if isinstance(temp_raw, float) else temp_raw
    humidity_value = int(humidity_raw * 100) if isinstance(humidity_raw, float) else humidity_raw
    
    return temperature_value, humidity_value

def read_modbus_data(client):
    """Đọc dữ liệu từ Modbus server"""
    try:
        registers = client.read_input_registers(REGISTER_ADDRESS_RAW, REGISTER_COUNT)
        
        if registers is not None:
            log(f"📥 Modbus raw: {registers}")
            return registers
        else:
            log(f"❌ Đọc Modbus thất bại: {client.last_error} - {client.last_error_as_txt}", "error")
            return None
    except Exception as e:
        log(f"❌ Lỗi đọc Modbus: {e}", "error")
        return None

# ==================== HÀM CHÍNH ====================
def main():
    clear_screen()
    
    print("=" * 60)
    print("MODBUS TCP → PLC KEYENCE - CẦU NỐI DỮ LIỆU")
    print("=" * 60)
    
    print("\n📡 [MODBUS SOURCE]")
    print(f"   Server: {MODBUS_SERVER_IP}:{MODBUS_SERVER_PORT}")
    print(f"   Unit ID: {UNIT_ID}")
    print(f"   Register: Address raw={REGISTER_ADDRESS_RAW} (Display {DISPLAY_BASE_ADDRESS})")
    print(f"   Format: {DATA_FORMAT_MODBUS}")
    
    print("\n📝 [PLC TARGET]")
    print(f"   PLC Keyence: {PLC_IP}:{PLC_PORT}")
    print(f"   Thanh ghi nhiệt độ: {DEVICE_TYPE}{START_REGISTER}")
    print(f"   Thanh ghi độ ẩm: {DEVICE_TYPE}{START_REGISTER + 1}")
    
    print(f"\n⏱️  Chu kỳ đọc Modbus: {READ_INTERVAL} giây")
    print(f"⏱️  Chu kỳ ghi PLC: {WRITE_INTERVAL} giây")
    print("\n" + "=" * 60)
    
    # Khởi tạo Modbus client
    modbus_client = ModbusClient(
        host=MODBUS_SERVER_IP,
        port=MODBUS_SERVER_PORT,
        unit_id=UNIT_ID,
        auto_open=True,
        auto_close=False,
        timeout=2
    )
    
    # Khởi tạo PLC client
    plc = KeyencePLC()
    
    # Kết nối PLC
    print("\n🔄 Đang kết nối PLC Keyence...")
    while not plc.connect():
        print(f"⏱️  Chờ {RETRY_INTERVAL} giây để thử lại...")
        time.sleep(RETRY_INTERVAL)
    
    cycle = 0
    last_modbus_data = None
    last_temperature = None
    last_humidity = None
    consecutive_errors = 0
    
    # Biến để quản lý thời gian đọc/ghi độc lập
    last_read_time = 0
    last_write_time = 0
    
    try:
        while True:
            current_time = time.time()
            
            # ========== ĐỌC DỮ LIỆU TỪ MODBUS ==========
            if current_time - last_read_time >= READ_INTERVAL:
                last_read_time = current_time
                
                registers = read_modbus_data(modbus_client)
                
                if registers is not None:
                    last_modbus_data = registers
                    temperature, humidity = process_modbus_data(registers)
                    
                    if temperature is not None and humidity is not None:
                        last_temperature = temperature
                        last_humidity = humidity
                        log(f"✅ Modbus → Nhiệt độ: {temperature/100:.2f}°C ({temperature}), Độ ẩm: {humidity/100:.2f}% ({humidity})")
                    else:
                        log("⚠️ Không thể xử lý dữ liệu Modbus", "error")
                else:
                    log("⚠️ Không đọc được dữ liệu từ Modbus", "error")
            
            # ========== GHI DỮ LIỆU VÀO PLC ==========
            if current_time - last_write_time >= WRITE_INTERVAL:
                last_write_time = current_time
                cycle += 1
                
                clear_screen()
                
                # Hiển thị header
                print("=" * 60)
                print(f"CẦU NỐI MODBUS → PLC KEYENCE [Lần {cycle}]")
                print("=" * 60)
                print(f"⏰ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
                print(f"🔌 PLC Keyence: {'✅ Đã kết nối' if plc.connected else '❌ Mất kết nối'}")
                print(f"📡 Modbus: {'✅ Có dữ liệu' if last_modbus_data else '⏳ Chờ dữ liệu...'}")
                print("-" * 60)
                
                # Hiển thị dữ liệu Modbus hiện tại
                if last_temperature is not None and last_humidity is not None:
                    print(f"📥 DỮ LIỆU TỪ MODBUS:")
                    print(f"   🌡️  Nhiệt độ: {last_temperature/100:.2f} °C")
                    print(f"   💧 Độ ẩm: {last_humidity/100:.2f} %")
                    print(f"   📊 Raw: {last_temperature} (nhiệt độ), {last_humidity} (độ ẩm)")
                else:
                    print(f"⏳ Đang chờ dữ liệu từ Modbus...")
                
                print("-" * 60)
                
                # Kiểm tra kết nối PLC
                if not plc.connected:
                    print("🔄 Mất kết nối PLC, đang kết nối lại...")
                    while not plc.connect():
                        print(f"⏱️  Chờ {RETRY_INTERVAL} giây để thử lại...")
                        time.sleep(RETRY_INTERVAL)
                
                # Ghi dữ liệu vào PLC nếu có dữ liệu hợp lệ
                if last_temperature is not None and last_humidity is not None:
                    print(f"📤 GHI VÀO PLC KEYENCE:")
                    print(f"   🌡️  Ghi nhiệt độ: {last_temperature} vào {DEVICE_TYPE}{START_REGISTER}...")
                    temp_success = plc.write_single_device(str(START_REGISTER), last_temperature)
                    
                    time.sleep(0.1)
                    
                    print(f"   💧 Ghi độ ẩm: {last_humidity} vào {DEVICE_TYPE}{START_REGISTER + 1}...")
                    humidity_success = plc.write_single_device(str(START_REGISTER + 1), last_humidity)
                    
                    print("-" * 60)
                    if temp_success and humidity_success:
                        print("✅ GHI VÀO PLC THÀNH CÔNG!")
                        print(f"   - Nhiệt độ: {last_temperature/100:.2f}°C → {DEVICE_TYPE}{START_REGISTER}")
                        print(f"   - Độ ẩm: {last_humidity/100:.2f}% → {DEVICE_TYPE}{START_REGISTER + 1}")
                        consecutive_errors = 0
                    else:
                        consecutive_errors += 1
                        print("❌ GHI VÀO PLC THẤT BẠI!")
                        if not temp_success:
                            print(f"   - Lỗi ghi nhiệt độ vào {DEVICE_TYPE}{START_REGISTER}")
                        if not humidity_success:
                            print(f"   - Lỗi ghi độ ẩm vào {DEVICE_TYPE}{START_REGISTER + 1}")
                        
                        if consecutive_errors >= 3:
                            plc.connected = False
                else:
                    print("⏳ Chưa có dữ liệu Modbus, chờ chu kỳ sau...")
                
                print("-" * 60)
                print(f"⏱️  Chu kỳ đọc Modbus: {READ_INTERVAL}s | Ghi PLC: {WRITE_INTERVAL}s")
                print("   Nhấn Ctrl+C để dừng")
            
            time.sleep(0.5)  # Tránh CPU 100%
            
    except KeyboardInterrupt:
        print("\n\n✅ Dừng chương trình")
    except Exception as e:
        print(f"\n❌ Lỗi nghiêm trọng: {e}")
    finally:
        if modbus_client.is_open:
            modbus_client.close()
        plc.disconnect()
        print("👋 Đã đóng kết nối Modbus và PLC")

if __name__ == "__main__":
    main()