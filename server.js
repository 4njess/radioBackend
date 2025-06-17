const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const pool = require("./db.js");

dotenv.config();
const app = express();
const server = http.createServer(app);

// Разрешенные домены
const allowedOrigins = [
    "http://localhost:3000",
    "https://radioinear.vercel.app",
    "https://radioclient-gacetihnu-linear-80e9e17cvercel.app",
    "https://radiobackend-iss7.onrender.com", 
];

// Настройка CORS
app.use(
    cors({
        origin: function (origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error("Not allowed by CORS"));
            }
        },
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "Range"],
        exposedHeaders: ["Content-Length", "Content-Range"],
        credentials: true,
    })
);
app.get("/", (req, res) => {
    res.send("🎧 Радио-сервер запущен и работает");
});
// Настройка Socket.IO
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true,
    },
    transports: ["websocket", "polling"],
});

app.use(express.json());
app.use("/api", require("./routes/apiRoute.js"));
// Изменяем структуру для раздельных очередей и позиций
const queues = {
    rock: { youtube: [], rutube: [] },
    hiphop: { youtube: [], rutube: [] },
    electronic: { youtube: [], rutube: [] },
};

let pendingRequests = [];
global.userNotifications = [];

// Изменяем структуру для раздельных текущих треков
const currentTracks = {
    rock: { youtube: null, rutube: null },
    hiphop: { youtube: null, rutube: null },
    electronic: { youtube: null, rutube: null },
};

// Добавляем состояние текущей платформы для каждого жанра
const currentPlatforms = {
    rock: "youtube",
    hiphop: "youtube",
    electronic: "youtube",
};

function parseISODuration(d) {
    const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

function isTrackPlaying(t) {
    if (!t) return false;
    return (Date.now() - t.startedAt) / 1000 < t.durationSec;
}

// Изменяем функцию для запуска следующего трека с учетом платформы
function startNextTrack(genre, platform) {
    const queueForPlatform = queues[genre][platform];

    if (queueForPlatform.length === 0) {
        currentTracks[genre][platform] = null;
        io.emit(`now-playing-${genre}-${platform}`, null);
        return;
    }

    const next = queueForPlatform.shift();
    currentTracks[genre][platform] = { ...next, startedAt: Date.now() };

    io.emit(`queue-update-${genre}-${platform}`, queueForPlatform);
    io.emit(`now-playing-${genre}-${platform}`, currentTracks[genre][platform]);

    setTimeout(() => startNextTrack(genre, platform), next.durationSec * 1000);
}

io.on("connection", (socket) => {
    console.log("🔌 Новый клиент");

    socket.on("get-moderation-queue", () => {
        socket.emit("moderation-queue", pendingRequests);
    });

    socket.on("register-user", (userId) => {
        if (userId) socket.join(userId);
    });

    // Отправляем текущее состояние при подключении
    for (const genre of Object.keys(currentTracks)) {
        for (const platform of ["youtube", "rutube"]) {
            socket.emit(
                `now-playing-${genre}-${platform}`,
                currentTracks[genre][platform]
            );
            socket.emit(
                `queue-update-${genre}-${platform}`,
                queues[genre][platform]
            );
        }
    }
    socket.emit("moderation-queue", pendingRequests);

    // Обработчик запроса очереди
    socket.on("get-queue", ({ genre, platform }) => {
        socket.emit(
            `queue-update-${genre}-${platform}`,
            queues[genre][platform]
        );

        const cur = currentTracks[genre][platform];
        if (isTrackPlaying(cur)) {
            socket.emit(`now-playing-${genre}-${platform}`, cur);
        } else if (queues[genre][platform].length) {
            startNextTrack(genre, platform);
        } else {
            socket.emit(`now-playing-${genre}-${platform}`, null);
        }
    });

    // Обработчик смены платформы
    socket.on("change-platform", ({ genre, platform }) => {
        currentPlatforms[genre] = platform;

        // Если текущий трек не соответствует платформе - останавливаем
        if (
            currentTracks[genre][platform] &&
            currentTracks[genre][platform].platform !== platform
        ) {
            currentTracks[genre][platform] = null;
            io.emit(`now-playing-${genre}-${platform}`, null);
        }

        // Запускаем следующий трек, если очередь не пуста
        if (queues[genre][platform].length) {
            startNextTrack(genre, platform);
        }
    });

    socket.on("new-request", ({ genre, request, platform }) => {
        pendingRequests.push({
            ...request,
            id: uuidv4(),
            genre,
            platform,
            status: "sent",
            timestamp: new Date(),
        });
        io.emit("moderation-queue", pendingRequests);
        io.emit(`cooldown-update-${genre}`, {
            userId: request.userId,
            genre,
            until: Date.now() + 60 * 1000, // 5 минут
        });
    });

    socket.on("moderate-request", async ({ id, action, reason }) => {
        const idx = pendingRequests.findIndex((r) => r.id === id);
        if (idx === -1) return;
        const reqObj = pendingRequests.splice(idx, 1)[0];
        const { genre, track, username, message, title, userId, platform } =
            reqObj;

        if (action === "approve") {
            let durationSec = 180;
            if (platform === "youtube") {
                try {
                    const vidId = new URL(track).searchParams.get("v");
                    const resp = await axios.get(
                        "https://www.googleapis.com/youtube/v3/videos",
                        {
                            params: {
                                key: process.env.YOUTUBE_API_KEY,
                                id: vidId,
                                part: "contentDetails",
                            },
                        }
                    );
                    const iso = resp.data.items?.[0]?.contentDetails?.duration;
                    durationSec = parseISODuration(iso) || durationSec;
                } catch (e) {
                    console.warn(
                        "YouTube duration fetch failed, using default"
                    );
                }
            }
            durationSec = durationSec || 180;

            const enriched = { ...reqObj, durationSec };

            // Добавляем в очередь соответствующей платформы
            queues[genre][platform].push(enriched);

            // Сохраняем в БД
            await pool.query(
                `INSERT INTO requests
            (id, genre, track, username, message, title, status,
            duration_sec, timestamp, started_at, user_id, platform)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
                [
                    enriched.id,
                    genre,
                    track,
                    username,
                    message,
                    title,
                    "approved",
                    enriched.durationSec,
                    new Date(),
                    new Date(),
                    userId,
                    platform,
                ]
            );

            // Обновляем очередь
            io.emit(
                `queue-update-${genre}-${platform}`,
                queues[genre][platform]
            );

            // Запускаем трек, если ничего не играет
            if (!isTrackPlaying(currentTracks[genre][platform])) {
                startNextTrack(genre, platform);
            }

            // Уведомление пользователю
            const notif = {
                userId,
                message: `Ваша заявка "${title}" одобрена ✅`,
                type: "success",
                read: false,
            };
            global.userNotifications.push(notif);
            io.to(userId).emit("new-notification", notif);
        }

        if (action === "reject") {
            const notif = {
                userId,
                message: `Заявка "${title}" отклонена ❌ Причина: ${reason}`,
                type: "error",
                read: false,
            };
            global.userNotifications.push(notif);
            io.to(userId).emit("new-notification", notif);
        }

        io.emit("moderation-queue", pendingRequests);
    });

    socket.on("disconnect", () => console.log("❌ Клиент отключён"));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Сервер на ${PORT}`));
