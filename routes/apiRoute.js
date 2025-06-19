//apiRoute.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage });

const { register, login} = require('../controllers/authController');
const {getCurrentPlayback} = require('../controllers/queryConroller')
const {getAllUsers, updateUser, deleteUser} = require('../controllers/usersActionsController')
const {ytSearch, notifications} = require('../controllers/youtubeController')
const {rtSearch, getRtStream} = require('../controllers/rutubeController')
const {proxyStream} = require('../controllers/proxyController')
const {getAvatar, uploadAvatar} = require('../controllers/avatarsController')

router.get('/playback/:genre', getCurrentPlayback);
router.post('/register', register);
router.post('/login', login);
router.get('/users', getAllUsers);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.get('/notifications/:id', notifications)
router.post('/search', ytSearch)

router.get('/proxy', proxyStream)
router.get("/rutube/stream/:videoId", getRtStream);
router.post('/search/rutube', rtSearch)

router.post('/users/:id/avatar', upload.single('avatar'), uploadAvatar);
router.get('/users/:id/avatar', getAvatar);

module.exports = router;
