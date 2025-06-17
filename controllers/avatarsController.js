const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const pool = require("../db");

const uploadAvatar = async (req, res) => {
    const { id } = req.params;
    try {
        const buffer = req.file.buffer;
        await pool.query("UPDATE users SET avatar=$1 WHERE id=$2", [
            buffer,
            id,
        ]);
        res.json({ message: "Аватар обновлён" });
    } catch (err) {
        console.error("UploadAvatar Error:", err.message);
        res.status(500).json({ message: "Ошибка сервера" });
    }
};

const getAvatar = async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await pool.query(
            "SELECT avatar FROM users WHERE id=$1",
            [id]
        );
        if (!rows.length || !rows[0].avatar)
            return res.status(404).json({ message: "Аватар не найден" });
        res.json({ avatar: rows[0].avatar.toString("base64") });
    } catch (err) {
        console.error("GetAvatar Error:", err.message);
        res.status(500).json({ message: "Ошибка сервера" });
    }
};

module.exports = {getAvatar, uploadAvatar}