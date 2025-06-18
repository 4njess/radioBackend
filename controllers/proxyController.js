//proxyController.js
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const pool = require("../db");

const proxyStream = async (req, res) => {
    let streamUrl = req.query.url;
    if (!streamUrl) return res.status(400).send("No URL provided");

    // Декодируем URL, если он был вложенным прокси
    if (streamUrl.includes(`${process.env.REACT_APP_API_URL}/api/proxy`)) {
        try {
            const urlObj = new URL(streamUrl);
            streamUrl = urlObj.searchParams.get("url");
        } catch (e) {
            console.warn("URL unpack error:", e.message);
        }
    }

    try {
        // Определяем тип контента по расширению
        const isPlaylist = streamUrl.includes(".m3u8");
        const isSegment = streamUrl.includes(".ts");

        // Устанавливаем необходимые заголовки
        const headers = {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36",
        };

        // Для сегментов добавляем Referer и Origin
        if (isSegment || isPlaylist) {
            headers.Referer = "https://rutube.ru/";
            headers.Origin = "https://rutube.ru";
        }

        // Обработка HLS плейлистов
        if (isPlaylist) {
            const response = await axios.get(streamUrl, {
                headers,
                responseType: "text",
            });

            const baseUrl = new URL(streamUrl);
            const proxyUrl = `${process.env.REACT_APP_API_URL}/api/proxy?url=`;

            // Обрабатываем все ссылки в плейлисте
            const processedPlaylist = response.data
                .split("\n")
                .map((line) => {
                    if (line.trim() === "" || line.startsWith("#")) {
                        return line;
                    }

                    try {
                        // Обрабатываем абсолютные и относительные URL
                        const segmentUrl = line.startsWith("http")
                            ? new URL(line)
                            : new URL(
                                line,
                                baseUrl.origin +
                                    baseUrl.pathname.replace(/\/[^/]+$/, "/")
                            );

                        return proxyUrl + encodeURIComponent(segmentUrl.href);
                    } catch (e) {
                        console.warn("Error processing playlist line:", line);
                        return line;
                    }
                })
                .join("\n");

            res.set({
                "Content-Type": "application/vnd.apple.mpegurl",
                "Access-Control-Allow-Origin": "*",
            });
            return res.send(processedPlaylist);
        }

        // Обработка видео-сегментов
        const range = req.headers.range;
        if (range) {
            headers.Range = range;
        }

        const response = await axios.get(streamUrl, {
            headers,
            responseType: "stream",
        });

        // Передаем заголовки от источника
        const passthroughHeaders = [
            "content-type",
            "content-length",
            "accept-ranges",
            "content-range",
            "content-disposition",
        ];

        passthroughHeaders.forEach((header) => {
            if (response.headers[header]) {
                res.set(header, response.headers[header]);
            }
        });

        // Устанавливаем CORS заголовки
        res.set({
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Expose-Headers": "*",
        });

        // Обработка частичного контента
        if (range) {
            res.status(206);
        }

        response.data.pipe(res);
    } catch (err) {
        console.error("Proxy error:", err.message);
        res.status(500).send("Proxy error: " + err.message);
    }
};

module.exports = { proxyStream };
