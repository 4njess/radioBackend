const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const pool = require("../db");


const getAllUsers = async (req, res) => {
    try {
        const { rows } = await pool.query(
            "SELECT id, username, role, is_premium, avatar FROM users"
        );
        const users = rows.map((u) => ({
            ...u,
            avatar: u.avatar ? u.avatar.toString("base64") : null,
        }));
        res.json(users);
    } catch (err) {
        console.error("GetAllUsers Error:", err.message);
        res.status(500).json({ message: "Ошибка сервера" });
    }
};

const updateUser = async (req, res) => {
    const { id } = req.params;
    const { username, password, role, is_premium } = req.body;

    try {
        // Если пароль не предоставлен, обновляем только имя пользователя, роль и премиум статус
        if (!password || password.trim() === "") {
            await pool.query(
                "UPDATE users SET username=$1, role=$2, is_premium=$3 WHERE id=$4",
                [username, role, is_premium, id]
            );
            return res.json({
                message: "Пользователь обновлён (без изменения пароля)",
            });
        }

        // Если пароль предоставлен - хешируем и обновляем
        const hashed = await bcrypt.hash(password, 10);
        await pool.query(
            "UPDATE users SET username=$1, password=$2, role=$3, is_premium=$4 WHERE id=$5",
            [username, hashed, role, is_premium, id]
        );
        res.json({ message: "Пользователь обновлён (с изменением пароля)" });
    } catch (err) {
        console.error("UpdateUser Error:", err.message);
        res.status(500).json({ message: "Ошибка сервера" });
    }
};

const deleteUser = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM users WHERE id=$1", [id]);
        res.json({ message: "Пользователь удалён" });
    } catch (err) {
        console.error("DeleteUser Error:", err.message);
        res.status(500).json({ message: "Ошибка сервера" });
    }
};

module.exports = { deleteUser, updateUser, getAllUsers};