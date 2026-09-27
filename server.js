require("dotenv").config(); // must stay first so process.env is ready

const { createApp } = require("./config/app");
const { connectDB } = require("./config/db");
const { connectRedis } = require("./config/redis");

const homeRoutes = require("./routes/home");
const authRoutes = require("./routes/logauth");
const dashboardRoutes = require("./routes/dashboard");
const verifyRoutes = require("./routes/verify");
const testViewerRoutes = require("./tests/testViewer");

const app = createApp();
const port = process.env.PORT || 3000;

app.use(homeRoutes);
app.use(authRoutes);
app.use(dashboardRoutes);
app.use(verifyRoutes);
app.use(testViewerRoutes);

connectDB();
connectRedis();

app.listen(port, () => {
  console.log(`Chama server running on http://localhost:${port}`);
});