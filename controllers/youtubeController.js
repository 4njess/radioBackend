// authController.js
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const pool = require("../db");

// Получение уведомлений пользователя
const notifications = async (req, res) => {
    const { id: userId } = req.params;
    const userNotifs = global.userNotifications.filter(
        (n) => n.userId === userId
    );
    res.json(userNotifs);
};

// Поиск на YouTube
const ytSearch = async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Нет запроса" });

    try {
        const { data } = await axios.get(
            "https://www.googleapis.com/youtube/v3/search",
            {
                params: {
                    key: process.env.YOUTUBE_API_KEY,
                    q: query,
                    part: "snippet",
                    type: "video",
                    maxResults: 1,
                },
            }
        );
        if (!data.items.length)
            return res.status(404).json({ error: "Видео не найдено" });

        const item = data.items[0];
        res.json({
            url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
            title: item.snippet.title,
        });
    } catch (err) {
        console.error("YouTube Search Error:", err.message);
        res.status(500).json({ error: "Ошибка поиска видео" });
    }
};

module.exports = { notifications, ytSearch };