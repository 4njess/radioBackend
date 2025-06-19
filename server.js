//server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const pool = require("./db.js");

dotenv.config();
const app = express();
const server = http.createServer(app);

// Разрешенные домены
const allowedOrigins = [
    "https://radioinear.vercel.app",
    "http://localhost:3000",
    "https://radioclient-gacetihnu-linear-80e9e17cvercel.app",
    "https://radiobackend-iss7.onrender.com",
];

// Логирование запросов для диагностики
app.use((req, res, next) => {
    console.log(
        `[${new Date().toISOString()}] ${req.method} ${req.url} | Origin: ${
            req.headers.origin
        }`
    );
    next();
});

// Основной CORS middleware
app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, DELETE, OPTIONS"
        );
        res.setHeader(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, Range"
        );
        res.setHeader(
            "Access-Control-Expose-Headers",
            "Content-Length, Content-Range"
        );
        res.setHeader("Access-Control-Allow-Credentials", "true");
    }

    // Обработка preflight запросов
    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

// Тестовые эндпоинты
app.get("/", (req, res) => {
    res.send("🎧 Радио-сервер запущен и работает");
});

app.get("/api/ping", (req, res) => {
    res.json({
        status: "ok",
        time: new Date(),
        environment: process.env.NODE_ENV,
        node: process.version,
    });
});

// Настройка Socket.IO
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true,
    },
    transports: ["websocket"],
});

app.use(express.json());
app.use("/api", require("./routes/apiRoute.js"));

// Инициализация структур данных
const queues = {
    rock: { youtube: [], rutube: [] },
    hiphop: { youtube: [], rutube: [] },
    electronic: { youtube: [], rutube: [] },
};

let pendingRequests = [];
global.userNotifications = [];

const currentTracks = {
    rock: { youtube: null, rutube: null },
    hiphop: { youtube: null, rutube: null },
    electronic: { youtube: null, rutube: null },
};

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
app.get("/health/routes", (req, res) => {
    const routes = [];
    app._router.stack.forEach((middleware) => {
        if (middleware.route) {
            // прямые маршруты (route)
            const methods = Object.keys(middleware.route.methods)
                .map((m) => m.toUpperCase())
                .join(",");
            routes.push(`${methods} ${middleware.route.path}`);
        } else if (middleware.name === "router") {
            // маршруты внутри роутеров
            middleware.handle.stack.forEach((handler) => {
                const route = handler.route;
                if (route) {
                    const methods = Object.keys(route.methods)
                        .map((m) => m.toUpperCase())
                        .join(",");
                    routes.push(`${methods} /api${route.path}`);
                }
            });
        }
    });
    res.json({ routes });
});

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

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log("Разрешенные домены:", allowedOrigins);
});

// Обработка необработанных ошибок
process.on("uncaughtException", (err) => {
    console.error("Необработанная ошибка:", err);
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("Необработанный rejection:", promise, "причина:", reason);
});
