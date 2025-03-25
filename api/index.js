const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

console.log("Database URL:", process.env.MONGO_URI);

//Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(err));

// Define Schema and Model
const appointmentSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  // time: {
  //     type: String,
  //     enum: ['10am', '1pm', '3pm', '5pm'],
  //     required: true,
  // },
  time: {
    type: String,
    required: true,
    validate: {
      validator: function (value) {
        return /^([0-1]\d|2[0-3]):([0-5]\d)$/.test(value); // Validates HH:mm format
      },
      message: (props) => `${props.value} is not a valid time!`,
    },
  },

  service: {
    type: String,
    enum: ["facial", "massage", "haircut", "manicure"],
    required: true,
  },
  specialRequests: {
    type: String,
    trim: true,
  },
});

const Appointment = mongoose.model("Appointment", appointmentSchema);

function formatTimeToAMPM(time) {
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const formattedHour = hour % 12 || 12; // Convert to 12-hour format
  return `${formattedHour}:${minutes} ${ampm}`;
}

// CRUD APIs
app.get("/", (req, res) => {
  res.send("Welcome to the Beauty Parlour API");
});

app.get("/appointments/:phone", async (req, res) => {
  try {
    console.log("Inside123");
    const appointment = await Appointment.findOne({ phone: req.params.phone });
    if (appointment) {
      const currentDate = new Date();
      const appointmentDate = new Date(appointment.date);

      // Format time to AM/PM before sending the response
      const formattedTime = formatTimeToAMPM(appointment.time);

      // Check if the current time is after the appointment time
      if (currentDate > appointmentDate) {
        await Appointment.deleteOne({ phone: req.params.phone });
        return res.json({
          exists: true,
          appointment: {
            ...appointment.toObject(),
            time: formattedTime,
          },
          pastAppointment: true,
        });
      } else {
        return res.json({
          exists: true,
          appointment: {
            ...appointment.toObject(),
            time: formattedTime,
          },
          pastAppointment: false,
        });
      }
    } else {
      res.json({ exists: false });
    }
  } catch (err) {
    res.status(500).send(err.message);
    console.log(err.message);
  }
});

app.post("/appointments", async (req, res) => {
  try {
    const { name, email, phone, date, time, service, specialRequests } =
      req.body;

    // Validate the time format
    if (!/^[0-2]\d:[0-5]\d$/.test(time)) {
      return res
        .status(400)
        .json({ message: "Invalid time format (HH:mm required)" });
    }

    // Validate the date format
    if (!date || isNaN(Date.parse(date))) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const parsedDate = new Date(date);

    // Check for required fields
    if (!name || !phone || !time || !service) {
      return res
        .status(400)
        .json({ message: "Name, phone, time, and service are required" });
    }

    // Check for existing appointment with the same date, time, and service
    const existingAppointment = await Appointment.findOne({
      date: parsedDate,
      time,
      service,
    });
    if (existingAppointment) {
      return res.json({
        message: `The slot for ${time} on ${parsedDate.toDateString()} for the service "${service}" is already booked. Please select another time or service.`,
      });
    }

    // Create a new appointment
    const newAppointment = new Appointment({
      name,
      email,
      phone,
      date: parsedDate,
      time,
      service,
      specialRequests,
    });
    await newAppointment.save();
    res.status(201).json(newAppointment);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.put("/appointments/:phone", async (req, res) => {
  try {
    const { phone } = req.params;
    const { date, time, service, ...otherFields } = req.body;

    // Validate the date format if provided
    if (date && isNaN(Date.parse(date))) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    // Validate the time format if provided
    if (time && !/^[0-2]\d:[0-5]\d$/.test(time)) {
      return res
        .status(400)
        .json({ message: "Invalid time format (HH:mm required)" });
    }

    const updateFields = { ...otherFields };
    if (date) updateFields.date = new Date(date);
    if (time) updateFields.time = time;
    if (service) updateFields.service = service;

    // Fetch the current appointment to check against its own data
    const existingAppointment = await Appointment.findOne({ phone });
    if (!existingAppointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    // Check if the updated time, date, and service conflict with other appointments
    if (
      (date || time || service) &&
      (date || existingAppointment.date) &&
      (time || existingAppointment.time) &&
      (service || existingAppointment.service)
    ) {
      const parsedDate = date ? new Date(date) : existingAppointment.date;
      const appointmentTime = time || existingAppointment.time;
      const appointmentService = service || existingAppointment.service;

      const conflict = await Appointment.findOne({
        date: parsedDate,
        time: appointmentTime,
        service: appointmentService,
        phone: { $ne: phone }, // Exclude the current appointment being updated
      });

      if (conflict) {
        return res.json({
          message: `The slot for ${appointmentTime} on ${parsedDate.toDateString()} for the service "${appointmentService}" is already booked. Please select another time or service.`,
        });
      }
    }

    // Perform the update
    const updatedAppointment = await Appointment.findOneAndUpdate(
      { phone },
      { $set: updateFields },
      { new: true } // Return the updated document
    );

    res.json(updatedAppointment);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.delete("/appointments/:phone", async (req, res) => {
  try {
    const deleted = await Appointment.findOneAndDelete({
      phone: req.params.phone,
    });
    if (deleted) {
      res.json(deleted);
    } else {
      res.status(404).json({ message: "Appointment not found" });
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

const PORT = 5056;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
