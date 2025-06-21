//server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const pool = require("./db.js");
const NodeCache = require("node-cache");
const stateCache = new NodeCache({ stdTTL: 0, checkperiod: 0 });

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

let pendingRequests = [];
global.userNotifications = [];

// Инициализация структур данных
const queues = {
    rock: { youtube: [], rutube: [] },
    hiphop: { youtube: [], rutube: [] },
    electronic: { youtube: [], rutube: [] },
};

const timers = {
    rock: { youtube: null, rutube: null },
    hiphop: { youtube: null, rutube: null },
    electronic: { youtube: null, rutube: null },
};

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

// function startNextTrack(genre, platform) {
//     const queueForPlatform = queues[genre][platform];

//     if (queueForPlatform.length === 0) {
//         currentTracks[genre][platform] = null;
//         io.emit(`now-playing-${genre}-${platform}`, null);
//         return;
//     }

//     const next = queueForPlatform.shift();
//     currentTracks[genre][platform] = { ...next, startedAt: Date.now() };

//     io.emit(`queue-update-${genre}-${platform}`, queueForPlatform);
//     io.emit(`now-playing-${genre}-${platform}`, currentTracks[genre][platform]);

//     setTimeout(() => startNextTrack(genre, platform), next.durationSec * 1000);
// }

// Обновляем функцию startNextTrack
// function startNextTrack(genre, platform) {
//     if (timers[genre][platform]) {
//         clearTimeout(timers[genre][platform]);
//         timers[genre][platform] = null;
//     }

//     const queueForPlatform = queues[genre][platform];

//     if (queueForPlatform.length === 0) {
//         currentTracks[genre][platform] = null;
//         io.emit(`now-playing-${genre}-${platform}`, null);
//         return;
//     }

//     const next = queueForPlatform.shift();
//     const now = Date.now();

//     // Сохраняем предыдущий прогресс
//     const prevTrack = currentTracks[genre][platform];
//     let startOffset = 0;

//     if (prevTrack) {
//         const elapsed = (now - prevTrack.startedAt) / 1000;
//         if (elapsed < prevTrack.durationSec) {
//             startOffset = elapsed;
//         }
//     }

//     currentTracks[genre][platform] = {
//         ...next,
//         startedAt: now - startOffset * 1000
//     };

//     io.emit(`queue-update-${genre}-${platform}`, queueForPlatform);
//     io.emit(`now-playing-${genre}-${platform}`, currentTracks[genre][platform]);

//     const remainingTime = next.durationSec * 1000 - startOffset * 1000;

//     timers[genre][platform] = setTimeout(
//         () => startNextTrack(genre, platform),
//         remainingTime
//     );
// }

function startNextTrack(genre, platform) {
    if (timers[genre][platform]) {
        clearTimeout(timers[genre][platform]);
        timers[genre][platform] = null;
    }

    const queueForPlatform = queues[genre][platform];

    if (queueForPlatform.length === 0) {
        currentTracks[genre][platform] = null;
        io.emit(`now-playing-${genre}-${platform}`, null);
        return;
    }
    const next = queueForPlatform.shift();

    const now = Date.now();
    currentTracks[genre][platform] = {
        ...next,
        startedAt: now,
    };

    // сразу же отдаем обновлённую очередь
    io.emit(`queue-update-${genre}-${platform}`, queueForPlatform);
    // и текущий трек
    io.emit(`now-playing-${genre}-${platform}`, currentTracks[genre][platform]);

    // сохраняем состояние, чтобы при рестарте старый трек не «вернулся»
    saveServerState();

    // планируем переход на следующий
    timers[genre][platform] = setTimeout(() => {
        // после проигрывания автоматически запустим следующий
        startNextTrack(genre, platform);
    }, next.durationSec * 1000);
}

// Функция сохранения состояния
function saveServerState() {
    const state = {
        queues,
        currentTracks,
        currentPlatforms,
        pendingRequests,
    };
    stateCache.set("serverState", state);
}

// Функция восстановления состояния
function loadServerState() {
    const savedState = stateCache.get("serverState");
    if (savedState) {
        Object.assign(queues, savedState.queues);
        Object.assign(currentTracks, savedState.currentTracks);
        Object.assign(currentPlatforms, savedState.currentPlatforms);
        pendingRequests = savedState.pendingRequests;

        // Перезапускаем таймеры
        for (const genre of Object.keys(currentTracks)) {
            for (const platform of ["youtube", "rutube"]) {
                const track = currentTracks[genre][platform];
                if (track && track.startedAt) {
                    const elapsed = (Date.now() - track.startedAt) / 1000;
                    const remaining = track.durationSec - elapsed;
                    if (remaining > 0) {
                        if (timers[genre][platform]) {
                            clearTimeout(timers[genre][platform]);
                        }

                        timers[genre][platform] = setTimeout(
                            () => startNextTrack(genre, platform),
                            remaining * 1000
                        );
                    } else {
                        startNextTrack(genre, platform);
                    }
                }
            }
        }
    }
}

io.on("connection", (socket) => {
    console.log("🔌 Новый клиент");
    loadServerState();

    const saveState = () => {
        saveServerState();
        // Отправляем актуальное состояние новому клиенту
        for (const genre of Object.keys(currentTracks)) {
            for (const platform of ["youtube", "rutube"]) {
                socket.emit(
                    `queue-update-${genre}-${platform}`,
                    queues[genre][platform]
                );
                socket.emit(
                    `now-playing-${genre}-${platform}`,
                    currentTracks[genre][platform]
                );
            }
        }
    };

    socket.on("get-moderation-queue", async () => {
        // вытаскиваем все заявки со статусом "sent"
        const { rows } = await pool.query(
            `SELECT id, genre, track, username, message, title, user_id AS "userId", platform
                FROM requests
                WHERE status = 'sent'
                ORDER BY timestamp`
        );
        // синхронизируем память
        pendingRequests = rows;
        socket.emit("moderation-queue", rows);
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

    socket.on("change-platform", ({ genre, platform }) => {
        saveState();

        const prevPlatform = currentPlatforms[genre];

        // Останавливаем таймер на предыдущей платформе
        if (timers[genre][prevPlatform]) {
            clearTimeout(timers[genre][prevPlatform]);
            timers[genre][prevPlatform] = null;
        }

        // Переключаем платформу
        currentPlatforms[genre] = platform;

        // Проверяем состояние на новой платформе
        const currentTrack = currentTracks[genre][platform];
        const queue = queues[genre][platform];

        // Если есть активный трек - перезапускаем таймер
        if (currentTrack && isTrackPlaying(currentTrack)) {
            const elapsed = (Date.now() - currentTrack.startedAt) / 1000;
            const remaining = currentTrack.durationSec - elapsed;

            if (remaining > 0) {
                timers[genre][platform] = setTimeout(
                    () => startNextTrack(genre, platform),
                    remaining * 1000
                );
            } else {
                startNextTrack(genre, platform);
            }
        }
        // Если нет активного трека, но есть очередь - запускаем следующий
        else if (queue.length > 0) {
            startNextTrack(genre, platform);
        }

        // Отправляем обновленное состояние
        io.emit(
            `now-playing-${genre}-${platform}`,
            currentTracks[genre][platform]
        );
        io.emit(`queue-update-${genre}-${platform}`, queue);
    });

    socket.on("new-request", async ({ genre, request, platform }) => {
        const id = uuidv4();
        const timestamp = new Date();

        // 1. Записываем в память
        pendingRequests.push({
            ...request,
            id,
            genre,
            platform,
            status: "sent",
            timestamp,
        });

        // 2. Сразу сохраняем в БД
        await pool.query(
            `INSERT INTO requests
        (id, genre, track, username, message, title, status, timestamp, user_id, platform)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
                id,
                genre,
                request.track,
                request.username,
                request.message,
                request.title,
                "sent",
                timestamp,
                request.userId,
                platform,
            ]
        );

        // 3. Рассылаем всем админам актуальный пул
        io.emit("moderation-queue", pendingRequests);

        // 4. Оповещение про cooldown
        io.emit(`cooldown-update-${genre}`, {
            userId: request.userId,
            genre,
            until: Date.now() + 60 * 1000,
        });
    });

    socket.on("sync-platform", ({ genre, platform }) => {
        const currentTrack = currentTracks[genre][platform];

        // Если трек играет - отправляем его текущее состояние
        if (currentTrack && isTrackPlaying(currentTrack)) {
            socket.emit(`now-playing-${genre}-${platform}`, currentTrack);
        }
        // Иначе отправляем null
        else {
            socket.emit(`now-playing-${genre}-${platform}`, null);
        }

        // Всегда отправляем актуальную очередь
        socket.emit(
            `queue-update-${genre}-${platform}`,
            queues[genre][platform]
        );
    });

    socket.on("moderate-request", async ({ id, action, reason }) => {
        saveState();
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
            if (platform === "rutube") {
                try {
                    // 1) Получаем rutId
                    const parsed = new URL(track);
                    const segments = parsed.pathname.split("/").filter(Boolean);
                    const rutId = segments[segments.length - 1];
                    if (!rutId) throw new Error("Invalid RuTube ID");

                    // 2) Берём master-playlist URL
                    const optsRes = await axios.get(
                        `https://rutube.ru/api/play/options/${rutId}/`,
                        {
                            headers: {
                                Referer: `https://rutube.ru/video/${rutId}/`,
                                Origin: "https://rutube.ru",
                            },
                        }
                    );
                    const masterUrl = optsRes.data.video_balancer?.m3u8;
                    if (!masterUrl) throw new Error("No m3u8 URL");

                    // 3) Скачиваем master-playlist
                    const masterRes = await axios.get(masterUrl, {
                        responseType: "text",
                    });
                    const lines = masterRes.data.split("\n");

                    // 4) Ищем первую variant
                    let variantLine;
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].startsWith("#EXT-X-STREAM-INF:")) {
                            variantLine = lines[i + 1];
                            break;
                        }
                    }
                    if (!variantLine) throw new Error("No variant found");

                    // 5) Формируем абсолютный URL variant
                    const masterBase = new URL(masterUrl);
                    const variantUrl = new URL(variantLine, masterBase).href;

                    console.log("Using variant playlist:", variantUrl);

                    // 6) Скачиваем variant-playlist и парсим #EXTINF
                    const variantRes = await axios.get(variantUrl, {
                        responseType: "text",
                    });
                    const parsedDuration = variantRes.data
                        .split("\n")
                        .filter((l) => l.startsWith("#EXTINF:"))
                        .map((l) => parseFloat(l.slice(8).split(",")[0]))
                        .reduce((sum, seg) => sum + seg, 0);

                    if (!parsedDuration || isNaN(parsedDuration)) {
                        console.warn("EXTINF parse failed, fallback 180s");
                        durationSec = 180;
                    } else {
                        durationSec = Math.floor(parsedDuration);
                        console.log(`Parsed RuTube duration: ${durationSec}s`);
                    }
                } catch (err) {
                    console.warn(
                        "Ошибка подсчёта длительности RuTube, fallback 180s",
                        err.message
                    );
                    durationSec = 180;
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

        await pool.query(`UPDATE requests SET status = $1 WHERE id = $2`, [
            action === "approve" ? "approved" : "rejected",
            id,
        ]);

        const { rows: updated } = await pool.query(
            `SELECT id, genre, track, username, message, title, user_id AS "userId", platform
                FROM requests
                WHERE status = 'sent'
                ORDER BY timestamp`
        );

        pendingRequests = updated;
        io.emit("moderation-queue", updated);
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
