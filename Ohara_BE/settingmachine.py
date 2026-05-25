import sqlite3
from pathlib import Path

from flask import Blueprint, jsonify, request, current_app


settingmachine_bp = Blueprint("settingmachine", __name__)


def get_setting_machine_db():
    db_path = current_app.config.get(
        "SETTING_MACHINE_DB_PATH",
        Path(__file__).resolve().parent / "database" / "settingmachine.db"
    )

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_warning_log_columns():
    """
    Đảm bảo bảng warning_alarm_logs có đủ cột xác nhận cảnh báo.
    Dùng để tránh lỗi nếu DB cũ chưa có is_confirmed / confirmed_at / confirmed_by.
    """
    db_path = Path(__file__).resolve().parent / "database" / "settingmachine.db"

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    try:
        columns = conn.execute("""
            PRAGMA table_info(warning_alarm_logs);
        """).fetchall()

        column_names = {column["name"] for column in columns}

        if "is_confirmed" not in column_names:
            conn.execute("""
                ALTER TABLE warning_alarm_logs
                ADD COLUMN is_confirmed INTEGER NOT NULL DEFAULT 0;
            """)

        if "confirmed_at" not in column_names:
            conn.execute("""
                ALTER TABLE warning_alarm_logs
                ADD COLUMN confirmed_at DATETIME;
            """)

        if "confirmed_by" not in column_names:
            conn.execute("""
                ALTER TABLE warning_alarm_logs
                ADD COLUMN confirmed_by TEXT;
            """)

        conn.commit()
    finally:
        conn.close()


def get_active_threshold(conn):
    return conn.execute("""
        SELECT *
        FROM threshold_settings
        WHERE is_active = 1
        ORDER BY id DESC
        LIMIT 1;
    """).fetchone()


def calc_status(mold_temp, env_temp, humidity, threshold):
    if (
        mold_temp >= threshold["alarm_mold_temp"]
        or env_temp >= threshold["alarm_env_temp"]
        or humidity >= threshold["alarm_humidity"]
    ):
        return "alarm"

    if (
        mold_temp >= threshold["warning_mold_temp"]
        or env_temp >= threshold["warning_env_temp"]
        or humidity >= threshold["warning_humidity"]
    ):
        return "warning"

    return "normal"


def get_active_alarm_map(conn):
    rows = conn.execute("""
        SELECT
            l.*
        FROM warning_alarm_logs l
        INNER JOIN (
            SELECT
                machine_id,
                MAX(
                    CASE status
                        WHEN 'alarm' THEN 2
                        WHEN 'warning' THEN 1
                        ELSE 0
                    END
                ) AS max_level
            FROM warning_alarm_logs
            WHERE is_deleted = 0
              AND COALESCE(is_confirmed, 0) = 0
            GROUP BY machine_id
        ) active
            ON active.machine_id = l.machine_id
           AND active.max_level = CASE l.status
                WHEN 'alarm' THEN 2
                WHEN 'warning' THEN 1
                ELSE 0
           END
        WHERE l.is_deleted = 0
          AND COALESCE(l.is_confirmed, 0) = 0
        ORDER BY l.machine_id ASC, l.occurred_at DESC, l.id DESC;
    """).fetchall()

    result = {}

    for row in rows:
        machine_id = row["machine_id"]
        if machine_id not in result:
            result[machine_id] = row

    return result


def get_active_unconfirmed_log(conn, machine_id):
    return conn.execute("""
        SELECT *
        FROM warning_alarm_logs
        WHERE machine_id = ?
          AND is_deleted = 0
          AND COALESCE(is_confirmed, 0) = 0
        ORDER BY
            CASE status
                WHEN 'alarm' THEN 2
                WHEN 'warning' THEN 1
                ELSE 0
            END DESC,
            occurred_at DESC,
            id DESC
        LIMIT 1;
    """, (machine_id,)).fetchone()


@settingmachine_bp.route("/api/settings/threshold", methods=["GET"])
def get_threshold_setting():
    with get_setting_machine_db() as conn:
        threshold = get_active_threshold(conn)

    if not threshold:
        return jsonify({"message": "Chưa có threshold setting"}), 404

    return jsonify({
        "warningMoldTemp": threshold["warning_mold_temp"],
        "alarmMoldTemp": threshold["alarm_mold_temp"],
        "warningTemp": threshold["warning_env_temp"],
        "alarmTemp": threshold["alarm_env_temp"],
        "warningHum": threshold["warning_humidity"],
        "alarmHum": threshold["alarm_humidity"],
    })


@settingmachine_bp.route("/api/settings/threshold", methods=["PUT"])
def update_threshold_setting():
    body = request.get_json() or {}

    required_fields = [
        "warningMoldTemp",
        "alarmMoldTemp",
        "warningTemp",
        "alarmTemp",
        "warningHum",
        "alarmHum",
    ]

    missing = [field for field in required_fields if field not in body]
    if missing:
        return jsonify({
            "message": "Thiếu dữ liệu",
            "missing": missing
        }), 400

    with get_setting_machine_db() as conn:
        active = get_active_threshold(conn)

        if active:
            conn.execute("""
                UPDATE threshold_settings
                SET
                    warning_mold_temp = ?,
                    alarm_mold_temp = ?,
                    warning_env_temp = ?,
                    alarm_env_temp = ?,
                    warning_humidity = ?,
                    alarm_humidity = ?,
                    is_active = 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?;
            """, (
                float(body["warningMoldTemp"]),
                float(body["alarmMoldTemp"]),
                float(body["warningTemp"]),
                float(body["alarmTemp"]),
                float(body["warningHum"]),
                float(body["alarmHum"]),
                active["id"],
            ))
        else:
            conn.execute("""
                INSERT INTO threshold_settings (
                    warning_mold_temp,
                    alarm_mold_temp,
                    warning_env_temp,
                    alarm_env_temp,
                    warning_humidity,
                    alarm_humidity,
                    is_active
                )
                VALUES (?, ?, ?, ?, ?, ?, 1);
            """, (
                float(body["warningMoldTemp"]),
                float(body["alarmMoldTemp"]),
                float(body["warningTemp"]),
                float(body["alarmTemp"]),
                float(body["warningHum"]),
                float(body["alarmHum"]),
            ))

        conn.commit()

    return jsonify({
        "message": "Cập nhật setting thành công",
        "setting": body
    })


@settingmachine_bp.route("/api/settings/chart-times", methods=["GET"])
def get_chart_time_settings():
    with get_setting_machine_db() as conn:
        rows = conn.execute("""
            SELECT id, label, interval_seconds, is_default, is_active
            FROM chart_time_settings
            WHERE is_active = 1
            ORDER BY interval_seconds ASC;
        """).fetchall()

    return jsonify([
        {
            "id": row["id"],
            "label": row["label"],
            "value": row["interval_seconds"],
            "intervalSeconds": row["interval_seconds"],
            "isDefault": bool(row["is_default"]),
        }
        for row in rows
    ])


@settingmachine_bp.route("/api/warning-logs", methods=["GET"])
def get_warning_logs():
    from machine import get_machine_name_map

    status = request.args.get("status", default="all")
    date_value = request.args.get("date")
    machine = request.args.get("machine", default="").strip().lower()
    machine_id = request.args.get("machineId", type=int)
    only_active = request.args.get("onlyActive", default="0")

    query = """
        SELECT
            id,
            machine_id,
            mold_temp,
            env_temp,
            humidity,
            status,
            message,
            occurred_at,
            COALESCE(is_confirmed, 0) AS is_confirmed,
            confirmed_at,
            confirmed_by
        FROM warning_alarm_logs
        WHERE is_deleted = 0
    """

    params = []

    if only_active in ["1", "true", "True"]:
        query += " AND COALESCE(is_confirmed, 0) = 0"

    if machine_id:
        query += " AND machine_id = ?"
        params.append(machine_id)

    if status in ["warning", "alarm"]:
        query += " AND status = ?"
        params.append(status)

    if date_value:
        query += " AND date(occurred_at) = date(?)"
        params.append(date_value)

    query += " ORDER BY COALESCE(is_confirmed, 0) ASC, occurred_at DESC, id DESC;"

    with get_setting_machine_db() as conn:
        rows = conn.execute(query, params).fetchall()

    machine_map = get_machine_name_map()

    data = []
    for row in rows:
        machine_info = machine_map.get(row["machine_id"], {})
        machine_name = machine_info.get("name", f"M{row['machine_id']}")

        if machine and machine not in machine_name.lower():
            continue

        data.append({
            "id": row["id"],
            "machineId": row["machine_id"],
            "machineName": machine_name,
            "time": row["occurred_at"],
            "moldTemp": row["mold_temp"],
            "envTemp": row["env_temp"],
            "hum": row["humidity"],
            "status": row["status"],
            "message": row["message"],
            "isConfirmed": bool(row["is_confirmed"]),
            "confirmedAt": row["confirmed_at"],
            "confirmedBy": row["confirmed_by"],
        })

    return jsonify(data)


@settingmachine_bp.route("/api/warning-logs/<int:log_id>/confirm", methods=["PUT"])
def confirm_warning_log(log_id):
    body = request.get_json() or {}
    confirmed_by = body.get("confirmedBy", "operator")

    with get_setting_machine_db() as conn:
        log = conn.execute("""
            SELECT *
            FROM warning_alarm_logs
            WHERE id = ?
              AND is_deleted = 0;
        """, (log_id,)).fetchone()

        if not log:
            return jsonify({
                "message": "Không tìm thấy log"
            }), 404

        conn.execute("""
            UPDATE warning_alarm_logs
            SET
                is_confirmed = 1,
                confirmed_at = CURRENT_TIMESTAMP,
                confirmed_by = ?
            WHERE id = ?;
        """, (
            confirmed_by,
            log_id,
        ))

        conn.commit()

    return jsonify({
        "message": "Đã xác nhận cảnh báo",
        "id": log_id
    })


@settingmachine_bp.route("/api/machines/<int:machine_id>/confirm-alerts", methods=["PUT"])
def confirm_machine_alerts(machine_id):
    from machine import get_machine_by_id

    body = request.get_json() or {}
    confirmed_by = body.get("confirmedBy", "operator")

    machine = get_machine_by_id(machine_id)

    if not machine:
        return jsonify({
            "message": "Không tìm thấy máy hoặc máy không active"
        }), 404

    with get_setting_machine_db() as conn:
        conn.execute("""
            UPDATE warning_alarm_logs
            SET
                is_confirmed = 1,
                confirmed_at = CURRENT_TIMESTAMP,
                confirmed_by = ?
            WHERE machine_id = ?
              AND is_deleted = 0
              AND COALESCE(is_confirmed, 0) = 0;
        """, (
            confirmed_by,
            machine_id,
        ))

        conn.commit()

    return jsonify({
        "message": "Đã xác nhận toàn bộ cảnh báo của máy",
        "machineId": machine_id
    })


@settingmachine_bp.route("/api/warning-logs", methods=["DELETE"])
def delete_warning_logs():
    with get_setting_machine_db() as conn:
        conn.execute("""
            UPDATE warning_alarm_logs
            SET is_deleted = 1
            WHERE is_deleted = 0;
        """)
        conn.commit()

    return jsonify({
        "message": "Đã xoá log cảnh báo"
    })