const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const pool = require("../db");

const getRtStream = async (req, res) => {
    const { videoId } = req.params;
    if (!videoId) return res.status(400).json({ error: "No video ID" });

    try {
        const response = await axios.get(
            `https://rutube.ru/api/play/options/${videoId}/`,
            {
                headers: {
                    Referer: `https://rutube.ru/video/${videoId}/`,
                    Origin: "https://rutube.ru",
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36",
                },
            }
        );

        const m3u8 = response.data?.video_balancer?.m3u8;
        if (!m3u8) {
            return res.status(404).json({ error: "Stream not found" });
        }

        res.json({ streamUrl: m3u8 });
    } catch (err) {
        console.error("RuTube stream error:", {
            message: err.message,
            response: err.response?.data,
        });

        let errorMessage = "Failed to get stream";
        if (err.response) {
            if (err.response.status === 404) {
                errorMessage = "Video not found";
            } else if (err.response.status === 403) {
                errorMessage = "Access forbidden";
            }
        }

        res.status(500).json({ error: errorMessage });
    }
};

// Поиск видео на RuTube
const rtSearch = async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Нет запроса" });

    try {
        const { data } = await axios.get(
            `https://rutube.ru/api/search/video/?query=${encodeURIComponent(
                query
            )}&limit=1`
        );
        const result = data.results?.[0];
        if (!result)
            return res.status(404).json({ error: "RuTube видео не найдено" });

        res.json({ url: result.id.toString(), title: result.title });
    } catch (err) {
        console.error("RuTube Search Error:", err.message);
        res.status(500).json({ error: "Ошибка поиска на RuTube" });
    }
};

module.exports = { rtSearch, getRtStream};