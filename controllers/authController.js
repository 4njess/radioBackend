const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const pool = require("../db");

// Регистрация пользователя
const register = async (req, res) => {
    const { username, password } = req.body;
    try {
        const { rows } = await pool.query(
            "SELECT 1 FROM users WHERE username = $1",
            [username]
        );
        if (rows.length)
            return res
                .status(400)
                .json({ message: "Пользователь уже существует" });

        const hashed = await bcrypt.hash(password, 10);
        const insert = await pool.query(
            "INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING *",
            [username, hashed, "user"]
        );
        const newUser = insert.rows[0];
        const token = jwt.sign(
            { id: newUser.id, role: newUser.role },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        res.status(201).json({
            token,
            username: newUser.username,
            role: newUser.role,
            id: newUser.id,
            is_premium: newUser.is_premium || false,
        });
    } catch (err) {
        console.error("Register Error:", err.message);
        res.status(500).json({ message: "Ошибка сервера" });
    }
};

// Логин пользователя
const login = async (req, res) => {
    const { username, password } = req.body;
    try {
        const { rows } = await pool.query(
            "SELECT * FROM users WHERE username = $1",
            [username]
        );
        const user = rows[0];
        if (!user)
            return res
                .status(400)
                .json({ message: "Неверное имя пользователя" });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(400).json({ message: "Неверный пароль" });

        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );
        res.json({
            token,
            username: user.username,
            role: user.role,
            id: user.id,
            is_premium: user.is_premium,
        });
    } catch (err) {
        console.error("Login Error:", err.message);
        res.status(500).json({ message: "Ошибка сервера" });
    }
};



module.exports = {
    register,
    login,
};
