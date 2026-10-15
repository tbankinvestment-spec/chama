require("dotenv").config(); // must stay first so process.env is ready

const { createApp } = require("./config/app");
const { connectDB } = require("./config/db");
const { connectRedis } = require("./config/redis");

const homeRoutes = require("./routes/home");
const authRoutes = require("./routes/logauth");
const apiAuthRoutes = require("./routes/apiAuth");
const dashboardRoutes = require("./routes/dashboard");
const verifyRoutes = require("./routes/verify");
const testViewerRoutes = require("./tests/testViewer");
const authApiRoutes = require("./routes/authRoutes");   // real JWT-backed auth API
const kycRoutes = require("./routes/kycRoutes");         // real multer-backed KYC uploads

const app = createApp();
const port = process.env.PORT || 3000;

app.use(homeRoutes);
app.use(authRoutes);
app.use(apiAuthRoutes);
app.use(dashboardRoutes);
app.use(verifyRoutes);
app.use(testViewerRoutes);
app.use("/auth", authApiRoutes);   // → /auth/register, /auth/login, /auth/verify-email, /auth/send-code …
app.use("/kyc", kycRoutes);        // → /kyc/passport-photo, /kyc/national-id

connectDB();
connectRedis();

app.listen(port, () => {
  console.log(`Chama server running on http://localhost:${port}`);
});
