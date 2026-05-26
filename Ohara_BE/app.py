from pathlib import Path

from flask import Flask, jsonify
from flask_cors import CORS

from machine import machine_bp
from settingmachine import (
    settingmachine_bp,
    ensure_warning_log_columns,
    ensure_machine_threshold_table,
)


BASE_DIR = Path(__file__).resolve().parent
DB_DIR = BASE_DIR / "database"

MACHINE_DB_PATH = DB_DIR / "machine.db"
SETTING_MACHINE_DB_PATH = DB_DIR / "settingmachine.db"


def create_app():
    app = Flask(__name__)
    CORS(app)

    app.config["BASE_DIR"] = BASE_DIR
    app.config["DB_DIR"] = DB_DIR
    app.config["MACHINE_DB_PATH"] = MACHINE_DB_PATH
    app.config["SETTING_MACHINE_DB_PATH"] = SETTING_MACHINE_DB_PATH

    app.register_blueprint(machine_bp)
    app.register_blueprint(settingmachine_bp)

    with app.app_context():
      ensure_warning_log_columns()
      ensure_machine_threshold_table()

    @app.route("/")
    def home():
        return jsonify({
            "message": "Ohara API is running",
            "machineDb": str(MACHINE_DB_PATH),
            "settingMachineDb": str(SETTING_MACHINE_DB_PATH),
        })

    return app


app = create_app()


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )