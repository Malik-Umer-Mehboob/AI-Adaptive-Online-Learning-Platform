var express = require('express');
var router = express.Router();

const adminRoutes = require('./admin');
const authRoutes = require('./auth');
const dashboardRoutes = require('./dashboard');
const usersRoutes = require('./user');

router.use('/admin', adminRoutes);
router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/users', usersRoutes);

module.exports = router;