//queryController.js
const pool = require('../db');

const getCurrentPlayback = async (req, res) => {
    const { genre } = req.params;
    try {
        const result = await pool.query(`
            SELECT *
            FROM requests
            WHERE genre = $1
            ORDER BY timestamp DESC
            LIMIT 1
        `, [genre]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Нет активного трека для этого жанра" });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error("Ошибка при получении текущего трека:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
};

// ❗️ ДОБАВЬ ЭТО:
module.exports = { getCurrentPlayback };
