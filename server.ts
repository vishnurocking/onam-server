// C:\Users\91999\MERN\LMS-onam\server\server.ts

import { v2 as cloudinary } from "cloudinary";
import { app } from "./app";
import connectDB from "./utils/db";
require("dotenv").config();

// cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_SECRET_KEY,
});

// create server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server is connected with port ${PORT}`);
  connectDB();
});
