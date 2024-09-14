import { NextFunction, Request, Response } from "express";
import { CatchAsyncError } from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/ErrorHandler";
import { IOrder } from "../models/order.Model";
import userModel from "../models/user.model";
import CourseModel, { ICourse } from "../models/course.model";
import path from "path";
import ejs from "ejs";
import sendMail from "../utils/sendMail";
import NotificationModel from "../models/notification.Model";
import { getAllOrdersService, newOrder } from "../services/order.service";
import { redis } from "../utils/redis";
import Razorpay from "razorpay";
import crypto from "crypto";
require("dotenv").config();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "",
});

// create order
export const createOrder = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { courseId, payment_info } = req.body as IOrder;

      if (payment_info) {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
          payment_info as {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          };

        const body = razorpay_order_id + "|" + razorpay_payment_id;

        const expectedSignature = crypto
          .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
          .update(body.toString())
          .digest("hex");

        if (expectedSignature !== razorpay_signature) {
          return next(new ErrorHandler("Payment not authorized!", 400));
        }
      }

      const user = await userModel.findById(req.user?._id);

      const courseExistInUser = user?.courses.some(
        (course: any) => course._id.toString() === courseId
      );

      if (courseExistInUser) {
        return next(
          new ErrorHandler("You have already purchased this course", 400)
        );
      }

      const course: ICourse | null = await CourseModel.findById(courseId);

      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }

      const data: any = {
        courseId: course._id,
        userId: user?._id,
        payment_info,
      };

      const mailData = {
        order: {
          _id: course._id.toString().slice(0, 6),
          name: course.name,
          price: course.price,
          date: new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
        },
      };

      const html = await ejs.renderFile(
        path.join(__dirname, "../mails/order-confirmation.ejs"),
        { order: mailData }
      );

      try {
        if (user) {
          await sendMail({
            email: user.email,
            subject: "Order Confirmation",
            template: "order-confirmation.ejs",
            data: mailData,
          });
        }
      } catch (error: any) {
        return next(new ErrorHandler(error.message, 500));
      }

      user?.courses.push(course?._id);

      await redis.set(req.user?._id, JSON.stringify(user));

      await user?.save();

      await NotificationModel.create({
        user: user?._id,
        title: "New Order",
        message: `You have a new order from ${course?.name}`,
      });

      course.purchased = course.purchased + 1;

      await course.save();

      newOrder(data, res, next);
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// get All orders --- only for admin
export const getAllOrders = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      getAllOrdersService(res);
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// send Razorpay key
export const sendRazorpayKey = CatchAsyncError(
  async (req: Request, res: Response) => {
    res.status(200).json({
      razorpayKey: process.env.RAZORPAY_KEY_ID,
    });
  }
);

// create Razorpay order
export const createRazorpayOrder = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log("Req Body: ", req.body);
      const { amount } = req.body.amount;

      if (!amount || isNaN(amount) || amount < 100) {
        return next(
          new ErrorHandler(
            "Invalid amount. Amount should be in paise and at least 1 INR",
            400
          )
        );
      }

      const options = {
        amount: parseInt(amount),
        currency: "INR",
        receipt: crypto.randomBytes(10).toString("hex"),
      };

      const order = await razorpay.orders.create(options);

      res.status(200).json({
        success: true,
        order,
      });
    } catch (error: any) {
      console.error("Razorpay order creation error:", error);
      return next(
        new ErrorHandler(
          error.message || "Failed to create Razorpay order",
          500
        )
      );
    }
  }
);
