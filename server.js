require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const nodemailer = require('nodemailer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const admin = require('./firebaseAdmin');
const jwt = require('jsonwebtoken'); 


const jwtSecret = process.env.JWT_SECRET;


cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer storage configuration
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'VisitorPhotos',
    format: async (req, file) => 'png',
    public_id: (req, file) => new Date().toISOString() + '_' + file.originalname,
  },
});

const parser = multer({ storage: storage });

const app = express();
const PORT = process.env.PORT;

// Middleware
app.use(bodyParser.json());
app.use(cors());

// MongoDB connection (MongoDB Atlas)
const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Connected to MongoDB Atlas');
}).catch((error) => {
  console.error('Error connecting to MongoDB:', error);
});


//VISITOR MANAGEMENT START HERE



const internSchema = new mongoose.Schema({
  name: { type: String, required: true },
  dob: { type: Date, required: true },
  aadhar: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  coordinator: { type: String, required: true },
  employeeEmail: { type: String, required: true },
  photoUrl: { type: String },
  aadharPhotoUrl: { type: String },
  isIntern: { type: Boolean, required: true },
  internshipFrom: { type: Date, required: function() { return this.isIntern; } },
  internshipTo: { type: Date, required: function() { return this.isIntern; } },
  verified: { type: Boolean, default: false },
}, { timestamps: true }); // Adding timestamps


const Intern = mongoose.model("Intern", internSchema);





app.post('/api/interns', async (req, res) => {
  try {
    console.log('Request body:', req.body);
    const { name, dob, aadhar, email, phone, coordinator, employeeEmail, photoUrl, aadharPhotoUrl, isIntern, internshipFrom, internshipTo } = req.body;

    if (!photoUrl ||!aadharPhotoUrl) {
      return res.status(400).send('photoUrl and aadharPhotoUrl are required');
    }

    const intern = new Intern({
      name,
      dob,
      aadhar,
      email,
      phone,
      coordinator,
      employeeEmail,
      photoUrl,
      aadharPhotoUrl,
      isIntern,
      internshipFrom,
      internshipTo,
      verified: false,
    });

    console.log('Intern document:', intern);

    await intern.save();

    const verificationToken = intern._id.toString();
    const verificationLink = `http://localhost:5001/api/verify-intern/${verificationToken}`;

    const mailOptions = {
      from: 'ongcinterns@gmail.com',
      to: employeeEmail,
      subject: 'New Intern Details - Verification Required',
      html: `
        <p>Name: ${intern.name}</p>
        <p>Date of Birth: ${intern.dob}</p>
        <p>Aadhar: ${intern.aadhar}</p>
        <p>Email: ${intern.email}</p>
        <p>Phone: ${intern.phone}</p>
        <p>Please verify the intern by clicking the button below:</p>
        <a href="${verificationLink}" style="display: inline-block; padding: 10px 20px; color: white; background-color: blue; text-align: center; text-decoration: none; border-radius: 5px;">Verify Intern</a>
      `,
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json(intern);
  } catch (error) {
    console.error('Error submitting intern details:', error.stack);
    res.status(500).send('Error submitting intern details');
  }
});

app.get('/api/verify-intern/:internId', async (req, res) => {
  try {
    const internId = req.params.internId;
    const intern = await verifyIntern(internId);
    if (!intern) {
      return res.status(404).send('Intern not found');
    }

    const qrCodeImage = await generateInternQrCode(intern);
    const mailOptions = await getInternMailOptions(intern, qrCodeImage);

    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error(`Error sending email: ${err.message}`);
        console.error(err.stack);
        res.status(500).send('Error sending email');
      } else {
        console.log(`Email sent to ${intern.email}`);
        res.send('Email sent successfully');
      }
    });
  } catch (err) {
    console.error(`Error verifying intern: ${err.message}`);
    console.error(err.stack);
    res.status(500).send('Error verifying intern');
  }
});


async function verifyIntern(internId) {
  try {
    const intern = await Intern.findByIdAndUpdate(internId, { verified: true }, { new: true });

    if (!intern) {
      return null;
    }

    return intern;
  } catch (err) {
    console.error(`Error verifying intern: ${err.message}`);
    throw err;
  }
}


async function generateInternQrCode(intern) {
  // Generate QR code with intern information
  const qrCodeData = {
    name: intern.name,
    id: intern._id,
    coordinator: intern.coordinator,
    intern: intern.isIntern,
  };

  const qrCodeString = JSON.stringify(qrCodeData);
  return qrcode.toBuffer(qrCodeString, {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    width: 200,
    height: 200,
  });
}

async function getInternMailOptions(intern, qrCodeImage) {
  // Get mail options with QR code attachment
  const mailOptions = {
    from: 'ongcinterns@gmail.com',
    to: intern.email,
    subject: 'Your Intern Verification',
    html: await getInternEmailTemplate(intern),
    attachments: [
      {
        filename: 'intern_verification.png',
        content: qrCodeImage,
        contentType: 'image/png',
      },
    ],
  };
  return mailOptions;
}

async function getInternEmailTemplate(intern) {
  // Get email template with intern details
  const passDate = new Date().toLocaleDateString();
  const emailTemplate = ejs.render(`
    <h2>Intern Verification</h2>
    <p>Dear ${intern.name},</p>
    <p>Your internship has been verified. Here are your details:</p>
    <ul>
      <li>Name: ${intern.name}</li>
      <li>Date of Birth: ${intern.dob}</li>
      <li>Aadhar: ${intern.aadhar}</li>
      <li>Email: ${intern.email}</li>
      <li>Phone: ${intern.phone}</li>
      <li>Coordinator: ${intern.coordinator}</li>
      <li>Internship Period: ${intern.internshipFrom} to ${intern.internshipTo}</li>
      <li>Date: ${passDate}</li>
    </ul>
    <p>Please keep this for your records.</p>
  `);
  
  return emailTemplate;
}


const employeeMailSchema = new mongoose.Schema({
  "CPF NO": { type: String, required: true },
  NAME: { type: String, required: true },
  "DESIGNATION TEXT": { type: String, required: true },
  EMAIL: { type: String, required: true },
});

const EmployeeMail = mongoose.model('employeemails', employeeMailSchema);

app.get('/api/employees/search', async (req, res) => {
  const { name } = req.query;
  try {
    // Perform a case-insensitive search for employees by name in MongoDB
    const employees = await EmployeeMail.find({ NAME: { $regex: new RegExp(name, 'i') } }).exec();
    res.json(employees);
  } catch (err) {
    console.error('Error searching employees:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Define schema and model for Indian visitors
const visitorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  dob: { type: Date, required: true },
  aadhar: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  visiting: { type: String, required: true },
  employeeEmail: { type: String, required: true },
  verified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  photoUrl: { type: String, required: true },
  aadharPhotoUrl: { type: String, required: true },

  
});

const Visitor = mongoose.model('Visitor', visitorSchema);



// Define schema and model for foreign visitors
const foreignVisitorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  dob: { type: Date, required: true },
  passport: { type: String, required: true },
  country: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  visiting: { type: String, required: true },
  employeeEmail: { type: String, required: true },
  verified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  photoUrl: { type: String, required: true },
  passportPhotoUrl: { type: String, required: true },
});

const ForeignVisitor = mongoose.model('ForeignVisitor', foreignVisitorSchema);




// Endpoint for uploading visitor photo
app.post('/api/upload/visitor-photo', parser.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      throw new Error('No file uploaded');
    }
    const result = req.file.path; // Cloudinary URL of the uploaded image
    res.json({ message: 'Visitor photo uploaded successfully', url: result });
  } catch (error) {
    console.error('Error uploading visitor photo:', error);
    res.status(500).send('Error uploading visitor photo');
  }
});


// Endpoint for uploading Aadhar card photo
app.post('/api/upload/aadhar-photo', parser.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      throw new Error('No file uploaded');
    }
    const result = req.file.path; // Cloudinary URL of the uploaded image
    res.json({ message: 'Aadhar photo uploaded successfully', url: result });
  } catch (error) {
    console.error('Error uploading Aadhar photo:', error);
    res.status(500).send('Error uploading Aadhar photo');
  }
});



app.post('/api/upload/passport-photo', parser.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      throw new Error('No file uploaded');
    }
    const result = req.file.path; // Cloudinary URL of the uploaded image
    res.json({ message: 'Passport photo uploaded successfully', url: result });
  } catch (error) {
    console.error('Error uploading Passport photo:', error);
    res.status(500).send('Error uploading Passport photo');
  }
});




// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 465, // or 587
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Endpoint to handle foreign visitor form submission
app.post('/api/foreign-visitors', async (req, res) => {
  try {
    const { name, dob, passport, country, email, phone, visiting, employeeEmail, photoUrl, passportPhotoUrl } = req.body;

    // Save foreign visitor details to MongoDB with verified set to false
    const foreignVisitor = await ForeignVisitor.create({
      name,
      dob,
      passport,
      country,
      email,
      phone,
      visiting,
      employeeEmail,
      verified: false,
      photoUrl,
      passportPhotoUrl
    });

    // Generate a unique verification token
    const verificationToken = foreignVisitor._id.toString();

    // Create the verification link
    const verificationLink = `http://localhost:5001/api/verify-foreign/${verificationToken}`;

    // Email content with the verification button
    const mailOptions = {
      from: 'ongcinterns@gmail.com',
      to: employeeEmail,
      subject: 'New Foreign Visitor Details - Verification Required',
      html: `
        <p>Name: ${foreignVisitor.name}</p>
        <p>Dob: ${foreignVisitor.dob}</p>
        <p>Passport: ${foreignVisitor.passport}</p>
        <p>Email: ${foreignVisitor.email}</p>
        <p>Phone: ${foreignVisitor.phone}</p>
        <p>Please verify the foreign visitor by clicking the button below:</p>
        <a href="${verificationLink}" style="display: inline-block; padding: 10px 20px; color: white; background-color: blue; text-align: center; text-decoration: none; border-radius: 5px;">Verify Foreign Visitor</a>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log('Email sent to employee for foreign visitor verification');

    res.status(200).send('Foreign visitor details submitted! Please verify the foreign visitor.');
  } catch (error) {
    console.error('Error submitting foreign visitor details:', error);
    res.status(500).send('Error submitting foreign visitor details');
  }
});

const qrcode = require('qrcode');
const ejs = require('ejs');

// Endpoint to handle foreign visitor verification
app.get('/api/verify-foreign/:token', async (req, res) => {
  try {
    const visitorId = req.params.token;
    const foreignVisitor = await verifyForeignVisitor(visitorId);
    if (!foreignVisitor) {
      return res.status(404).send('Foreign visitor not found');
    }

    const qrCodeImage = await generateForeignQrCode(foreignVisitor);
    const emailTemplate = await getForeignEmailTemplate(foreignVisitor);
    const mailOptions = await getForeignMailOptions(foreignVisitor, qrCodeImage);

    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error(`Error sending email: ${err.message}`);
        console.error(err.stack);
        res.status(500).send('Error sending email');
      } else {
        console.log(`Email sent to ${foreignVisitor.email}`);
        res.send('Email sent successfully');
      }
    });
  } catch (err) {
    console.error(`Error verifying foreign visitor: ${err.message}`);
    console.error(err.stack);
    res.status(500).send('Error verifying foreign visitor');
  }
});

async function verifyForeignVisitor(visitorId) {
  // Verify foreign visitor and update their status
  const foreignVisitor = await ForeignVisitor.findById(visitorId);
  if (!foreignVisitor) {
    return null;
  }

  if (foreignVisitor.verified) {
    return null;
  }

  foreignVisitor.verified = true;
  await foreignVisitor.save();
  return foreignVisitor;
}

async function generateForeignQrCode(visitor) {
  // Generate QR code with visitor information
  const qrCodeData = {
    name: visitor.name,
    id: visitor._id,
    passport: visitor.passport,
  };

  const qrCodeString = JSON.stringify(qrCodeData);
  return qrcode.toBuffer(qrCodeString, {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    width: 200,
    height: 200,
  });
}

async function getForeignEmailTemplate(visitor) {
  // Get email template with visitor details
  const passDate = new Date().toLocaleDateString();
  const emailTemplate = ejs.render(`
    <h2>Visitor Pass</h2>
    <p>Dear ${visitor.name},</p>
    <p>Your visit has been verified. Here are your details:</p>
    <ul>
      <li>Name: ${visitor.name}</li>
      <li>Date of Birth: ${visitor.dob}</li>
      <li>Passport: ${visitor.passport}</li>
      <li>Email: ${visitor.email}</li>
      <li>Phone: ${visitor.phone}</li>
      <li>Visiting: ${visitor.visiting}</li>
      <li>Date: ${passDate}</li>
    </ul>
    <p>Please present this pass upon your arrival.</p>
  `);
  return emailTemplate;
}

async function getForeignMailOptions(visitor, qrCodeImage) {
  // Get mail options with QR code attachment
  const mailOptions = {
    from: 'ongcinterns@gmail.com',
    to: visitor.email,
    subject: 'Your Visitor Pass',
    html: await getForeignEmailTemplate(visitor),
    attachments: [
      {
        filename: 'visitor_pass.png',
        content: qrCodeImage,
        contentType: 'image/png',
      },
    ],
  };
  return mailOptions;
}


// Endpoint to handle Indian visitor form submission
app.post('/api/visitors', async (req, res) => {
  try {
    console.log('Request body:', req.body);
    const { name, dob, aadhar, email, phone, visiting, employeeEmail, photoUrl, aadharPhotoUrl } = req.body;
    if (!photoUrl || !aadharPhotoUrl) {
      return res.status(400).send('photoUrl and aadharPhotoUrl are required');
    }
    // Save Indian visitor details to MongoDB with verified set to false
    const visitor = await Visitor.create({
      name,
      dob,
      aadhar,
      email,
      phone,
      visiting,
      employeeEmail,
      verified: false,
      photoUrl,
      aadharPhotoUrl,
    });

    // Generate a unique verification token
    const verificationToken = visitor._id.toString();

    // Create the verification link
    const verificationLink = `http://localhost:5001/api/verify/${verificationToken}`;

    // Email content with the verification button
    const mailOptions = {
      from: 'ongcinterns@gmail.com',
      to: employeeEmail,
      subject: 'New Visitor Details - Verification Required',
      html: `
        <p>Name: ${visitor.name}</p>
        <p>Date of Birth: ${visitor.dob}</p>
        <p>Aadhar: ${visitor.aadhar}</p>
        <p>Email: ${visitor.email}</p>
        <p>Phone: ${visitor.phone}</p>
        <p>Please verify the visitor by clicking the button below:</p>
        <a href="${verificationLink}" style="display: inline-block; padding: 10px 20px; color: white; background-color: blue; text-align: center; text-decoration: none; border-radius: 5px;">Verify Visitor</a>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log('Email sent to employee');

    res.status(200).send('Visitor details submitted! Please verify the visitor.');
  } catch (error) {
    console.error('Error submitting visitor details:', error);
    res.status(500).send('Error submitting visitor details');
  }
});




app.get('/api/verify/:token', async (req, res) => {
  try {
    const visitorId = req.params.token;
    const visitor = await verifyVisitor(visitorId);
    if (!visitor) {
      return res.status(404).send('Visitor not found');
    }

    const qrCodeImage = await generateQrCode(visitor);
    const emailTemplate = await getEmailTemplate(visitor);
    const mailOptions = await getMailOptions(visitor, qrCodeImage);

    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error(`Error sending email: ${err.message}`);
        console.error(err.stack);
        res.status(500).send('Error sending email');
      } else {
        console.log(`Email sent to ${visitor.email}`);
        res.send('Email sent successfully');
      }
    });
  } catch (err) {
    console.error(`Error verifying visitor: ${err.message}`);
    console.error(err.stack);
    res.status(500).send('Error verifying visitor');
  }
});

async function verifyVisitor(visitorId) {
  // Verify visitor and update their status
  const visitor = await Visitor.findById(visitorId);
  if (!visitor) {
    return null;
  }

  if (visitor.verified) {
    return null;
  }

  visitor.verified = true;
  await visitor.save();
  return visitor;
}

async function generateQrCode(visitor) {
  // Generate QR code with visitor information
  const qrCodeData = {
    name: visitor.name,
    id: visitor._id,
  };

  const qrCodeString = JSON.stringify(qrCodeData);
  return qrcode.toBuffer(qrCodeString, {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    width: 200,
    height: 200,
  });
}

async function getEmailTemplate(visitor) {
  // Get email template with visitor details
  const passDate = new Date().toLocaleDateString();
  const emailTemplate = ejs.render(`
    <h2>Visitor Pass</h2>
    <p>Dear ${visitor.name},</p>
    <p>Your visit has been verified. Here are your details:</p>
    <ul>
      <li>Name: ${visitor.name}</li>
      <li>Date of Birth: ${visitor.dob}</li>
      <li>Aadhar: ${visitor.aadhar}</li>
      <li>Email: ${visitor.email}</li>
      <li>Phone: ${visitor.phone}</li>
      <li>Visiting: ${visitor.visiting}</li>
      <li>Date: ${passDate}</li>
    </ul>
    <p>Please present this pass upon your arrival.</p>
  `);
  return emailTemplate;
}

async function getMailOptions(visitor, qrCodeImage) {
  // Get mail options with QR code attachment
  const mailOptions = {
    from: 'ongcinterns@gmail.com',
    to: visitor.email,
    subject: 'Your Visitor Pass',
    html: await getEmailTemplate(visitor),
    attachments: [
      {
        filename: 'visitor_pass.png',
        content: qrCodeImage,
        contentType: 'image/png',
      },
    ],
  };
  return mailOptions;
}


// Endpoint to fetch all visitors (normal visitors)
app.get('/api/visitors', async (req, res) => {
  try {
    // Fetch only normal visitors (visitors with 'aadhar' field)
    const normalVisitors = await Visitor.find({ aadhar: { $exists: true } }).sort({ createdAt: -1 });
    res.json(normalVisitors);
  } catch (error) {
    console.error('Error fetching normal visitors:', error);
    res.status(500).send('Error fetching normal visitors');
  }
});

// Endpoint to fetch all foreign visitors
app.get('/api/foreign-visitors', async (req, res) => {
  try {
    console.log('Fetching foreign visitors...');
    const foreignVisitors = await ForeignVisitor.find({ passport: { $exists: true } }).sort({ createdAt: -1 });
    console.log('Foreign Visitors found:', foreignVisitors.length); // Log the number of foreign visitors found
    if (foreignVisitors.length > 0) {
      console.log('First Foreign Visitor:', foreignVisitors[0]); // Log the first foreign visitor if exists
    }
    res.json(foreignVisitors);
  } catch (error) {
    console.error('Error fetching foreign visitors:', error);
    res.status(500).send('Error fetching foreign visitors');
  }
});


app.get('/api/interns', async (req, res) => {
  try {
    const interns = await Intern.find({});
    res.json(interns);
  } catch (error) {
    console.error('Error fetching interns:', error);
    res.status(500).json({ message: 'Error fetching interns' });
  }
});




//VISITOR MANAGEMENT ENDS HERE

//MAIN GATE STARTS HERE




//Visitor Location  start
const visitorLocationSchema = new mongoose.Schema({
  visitorId: String,
  location: { type: String, default: 'ONGC maine gate' },
  name: String,
  phone: String,
  visitingEmployee: String,
  date: Date,
  photoUrl: String,
  outTime: {
    type: Date,
    default: undefined
  },
  GeopicInTime: { type: Date, default: undefined },
  GeopicOutTime: { type: Date, default: undefined },
  rfidTag: String,
});

const VisitorLocation = mongoose.model('VisitorLocation', visitorLocationSchema);

app.get('/api/visitor-locations', async (req, res) => {
  try {
    const visitorLocations = await VisitorLocation.find();
    res.json(visitorLocations);
  } catch (error) {
    console.error('Error fetching visitor locations:', error);
    res.status(500).json({ message: 'Error fetching visitor locations' });
  }
});

// Update RFID tag
app.put('/api/visitor-locations/:id/rfid', async (req, res) => {
  const id = req.params.id;
  const { rfidTag } = req.body;

  try {
    const visitorLocation = await VisitorLocation.findById(id);
    if (!visitorLocation) {
      return res.status(404).json({ message: 'Visitor location not found' });
    }

    visitorLocation.rfidTag = rfidTag;
    visitorLocation.location = 'ONGC main gate';
    await visitorLocation.save();
    res.json({ message: 'RFID tag updated successfully', rfidTag: visitorLocation.rfidTag });
  } catch (error) {
    console.error('Error updating RFID tag:', error);
    res.status(500).json({ message: 'Error updating RFID tag' });
  }
});

// Delete RFID tag
app.delete('/api/visitor-locations/:id/rfid', async (req, res) => {
  const id = req.params.id;

  try {
    const visitorLocation = await VisitorLocation.findById(id);
    if (!visitorLocation) {
      return res.status(404).json({ message: 'Visitor location not found' });
    }

    visitorLocation.rfidTag = null;
    visitorLocation.location = 'Out of ONGC main gate';
    visitorLocation.outTime = new Date();

    await visitorLocation.save();
    res.json({ message: 'RFID tag deleted successfully' });
  } catch (error) {
    console.error('Error deleting RFID tag:', error);
    res.status(500).json({ message: 'Error deleting RFID tag' });
  }
});

//visitor location end


//STUDENT LOCATION STARTS HERE




const studentLocationSchema = new mongoose.Schema({
  studentId: String,
  location: { type: String, default: 'ONGC main gate' },
  name: String,
  phone: String,
  coordinator: String,
  date: Date,
  photoUrl: String,
  outTime: {
    type: Date,
    default: undefined,
  },
  GeopicInTime: { type: Date, default: undefined },
  GeopicOutTime: { type: Date, default: undefined },
}, { timestamps: true }); // Adding timestamps

const StudentLocation = mongoose.model('StudentLocation', studentLocationSchema);


app.get('/api/student-locations', async (req, res) => {
  try {
    const studentLocations = await StudentLocation.find().sort({ createdAt: -1 });
    res.json(studentLocations);
  } catch (error) {
    console.error('Error fetching student locations:', error);
    res.status(500).send('Error fetching student locations');
  }
});

app.post('/api/visitor-locations/:id', async (req, res) => {
  const id = req.params.id;
  const { passport, intern } = req.body;
  const isForeignVisitor = passport !== undefined;
  const isIntern = intern === true;

  try {
    let visitor;
    if (isForeignVisitor) {
      visitor = await ForeignVisitor.findById(id);
    } else if (isIntern) {
      visitor = await Intern.findById(id);
    } else {
      visitor = await Visitor.findById(id);
    }

    if (!visitor) {
      return res.status(404).json({ message: 'Visitor not found' });
    }

    const existingLocation = await (isIntern ? StudentLocation : VisitorLocation).findOne({
      studentId: id,
    });

    if (existingLocation) {
      return res.status(409).json({ message: 'Location already exists' });
    }

    let locationData;
    if (isIntern) {
      locationData = {
        studentId: id,
        location: 'ONGC main gate',
        name: visitor.name,
        phone: visitor.phone,
        coordinator: visitor.coordinator,
        date: new Date(),
        photoUrl: visitor.photoUrl,
    
      };
    } else {
      locationData = {
        visitorId: id,
        location: 'ONGC main gate',
        name: visitor.name,
        phone: visitor.phone,
        visitingEmployee: visitor.visiting,
        date: new Date(),
        photoUrl: visitor.photoUrl,
        rfidTag: visitor.rfidTag, // Ensure this field exists in visitor schema if necessary
      };
    }

    if (isIntern) {
      const studentLocation = new StudentLocation(locationData);
      await studentLocation.save();
      res.json({ message: 'Student location created successfully' });
    } else {
      const visitorLocation = new VisitorLocation(locationData);
      await visitorLocation.save();
      res.json({ message: 'Visitor location created successfully' });
    }
  } catch (error) {
    console.error('Error creating location:', error);
    res.status(500).json({ message: 'Error creating location' });
  }
});


app.post('/api/visitor-locations/:id/out', async (req, res) => {
  const id = req.params.id;
  const isForeignVisitor = req.body.passport !== undefined;

  console.log('Received request for visitor ID:', id);
  console.log('Request body:', req.body);

  try {
    let visitor;
    if (isForeignVisitor) {
      console.log('Fetching foreign visitor with ID:', id);
      visitor = await ForeignVisitor.findById(id);
    } else {
      console.log('Fetching Indian visitor with ID:', id);
      visitor = await Visitor.findById(id);
    }

    if (!visitor) {
      console.log('Visitor not found');
      return res.status(404).json({ message: 'Visitor not found' });
    }

    // Update existing visitor location
    const filter = { 
      name: visitor.name, 
      phone: visitor.phone, 
      visitingEmployee: visitor.visiting 
    };

    const update = {
      location: 'Out of ONGC main gate',
      outTime: new Date()
    };

    const options = {
      new: true // Return the modified document rather than the original
    };

    const updatedLocation = await VisitorLocation.findOneAndUpdate(filter, update, options);

    if (!updatedLocation) {
      console.log('Visitor location not found to update');
      return res.status(404).json({ message: 'Visitor location not found to update' });
    }

    console.log('Visitor location updated:', updatedLocation);
    res.json({ message: 'Visitor location updated successfully', updatedLocation });
  } catch (error) {
    console.error('Error updating visitor location:', error);
    res.status(500).json({ message: 'Error updating visitor location' });
  }
});

//Student loaction ends here


//Main gate Scanner ends here

//GEOPIC GATE SCANNER STARTS HERE

//IN SCANNER  API
app.put('/api/geopic-visitor-locations/:id', async (req, res) => {
  const id = req.params.id;
  const { passport, intern } = req.body;
  const isForeignVisitor = passport !== undefined;
  const isIntern = intern === true;

  // Define today and tomorrow for date range filtering
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  try {
    

    let visitor;
    if (isForeignVisitor) {
      visitor = await ForeignVisitor.findById(id);
    } else if (isIntern) {
      visitor = await Intern.findById(id);
    } else {
      visitor = await Visitor.findById(id);
    }

    if (!visitor) {
      console.log('Visitor not found');
      return res.status(404).json({ message: 'Visitor not found' });
    }

    

    let visitorLocation;
    if (isIntern) {
      visitorLocation = await StudentLocation.findOne({
        studentId: id,
        date: { $gte: today, $lt: tomorrow },
      });
    } else {
      visitorLocation = await VisitorLocation.findOne({
        name: visitor.name,
        phone: visitor.phone,
        visitingEmployee: visitor.visiting,
      });
    }

    if (!visitorLocation) {
      console.log('Visitor location not found');
      return res.status(404).json({ message: 'Visitor location not found' });
    }

    

    visitorLocation.location = 'Geopic';
    visitorLocation.GeopicInTime = new Date();
    await visitorLocation.save();

    res.json({ message: 'Visitor location updated successfully' });
  } catch (error) {
    console.error('Error updating visitor location:', error);
    res.status(500).json({ message: 'Error updating visitor location' });
  }
});
//OUT SCANNERA API
app.post('/api/geopic-visitor-locations/:id/out', async (req, res) => {
  const id = req.params.id;
  const isForeignVisitor = req.body.passport !== undefined;
  const isIntern = req.body.intern === true;

  console.log('Received request to update visitor location for ID:', id);
  console.log('Request body:', req.body);

  try {
    let visitor;
    if (isForeignVisitor) {
      console.log('Fetching foreign visitor with ID:', id);
      visitor = await ForeignVisitor.findById(id);
    } else if (isIntern) {
      console.log('Fetching intern with ID:', id);
      visitor = await Intern.findById(id);
    } else {
      console.log('Fetching Indian visitor with ID:', id);
      visitor = await Visitor.findById(id);
    }

    if (!visitor) {
      console.log('Visitor not found');
      return res.status(404).json({ message: 'Visitor not found' });
    }

    console.log('Visitor found:', visitor);

    let visitorLocation;
    if (isIntern) {
      visitorLocation = await StudentLocation.findOne({
        studentId: id,
      });
    } else {
      visitorLocation = await VisitorLocation.findOne({
        name: visitor.name,
        phone: visitor.phone,
        visitingEmployee: visitor.visiting,
      });
    }

    if (!visitorLocation) {
      console.log('Visitor location not found');
      return res.status(404).json({ message: 'Visitor location not found' });
    }

    visitorLocation.location = 'Out of GEOPIC';
    visitorLocation.GeopicOutTime = new Date();
    await visitorLocation.save();

    console.log('Visitor location updated successfully');
    res.json({ message: 'Visitor location updated successfully' });
  } catch (error) {
    console.error('Error updating visitor location:', error);
    res.status(500).json({ message: 'Error updating visitor location' });
  }
});

//GEOPIC GATE SCANNER ENDS HERE


//Admin Panel Starts Here
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['Admin', 'Employee', 'Security'], default: 'Employee' }
});

// Create a model based on the schema
const User = mongoose.model('User', userSchema);

app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username email role'); // Specify fields to return
    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

app.delete('/api/users', async (req, res) => {
  try {
    const { username, email } = req.body;

    if (!username || !email) {
      return res.status(400).json({ message: 'Username and email are required' });
    }

    // Find and delete the user from MongoDB
    const result = await User.findOneAndDelete({ username, email });

    if (!result) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Delete the user from Firebase Authentication
    try {
      const firebaseUser = await admin.auth().getUserByEmail(email);
      await admin.auth().deleteUser(firebaseUser.uid);
      console.log('Firebase user deleted successfully');
    } catch (err) {
      console.error('Error deleting Firebase user:', err);
      return res.status(500).json({ message: 'Failed to delete user from Firebase' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

app.put('/api/users/role', async (req, res) => {
  try {
    const { username, email, newRole } = req.body;
    console.log("Received request with:", { username, email, newRole }); // Log request data

    if (!username || !email || !newRole) {
      console.log("Missing required fields"); // Log missing fields
      return res.status(400).json({ message: 'Username, email, and new role are required' });
    }

    const validRoles = ['Admin', 'Security', 'Employee']; // Update valid roles here
    if (!validRoles.includes(newRole)) {
      console.log("Invalid role:", newRole); // Log invalid role
      return res.status(400).json({ message: 'Invalid role' });
    }

    const result = await User.findOneAndUpdate(
      { username, email },
      { role: newRole },
      { new: true }
    );

    if (!result) {
      console.log("User not found"); // Log user not found
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User role updated successfully', user: result });
  } catch (err) {
    console.error('Error updating user role:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});


app.post('/api/users', async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    // Validate role
    if (!['Admin', 'Security', 'Employee'].includes(role)) {
      return res.status(400).send('Invalid role');
    }

    // Check if the email already exists in Firebase
    const existingUser = await admin.auth().getUserByEmail(email).catch(error => {
      if (error.code === 'auth/user-not-found') {
        return null; // Email does not exist
      }
      throw error; // Some other error occurred
    });

    if (existingUser) {
      return res.status(400).json({ message: 'Email is already in use' });
    }

    // Create Firebase user
    const firebaseUser = await admin.auth().createUser({
      email,
      password,
      displayName: username,
    });

    // Create MongoDB user with plain text password
    const newUser = new User({
      username,
      email,
      password, // Store password as it is
      role,
      firebaseUid: firebaseUser.uid,
    });

    await newUser.save();

    res.status(201).json({ message: 'User created successfully', user: newUser });
  } catch (error) {
    console.error('Error creating user:', error.message);
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
});

//Admin Panel Ends Here


//Login API

app.post('/api/login', async (req, res) => {
  try {
    const { idToken } = req.body;

    // Verify Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const email = decodedToken.email;

    // Fetch user from MongoDB
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Generate JWT token with user role
    const token = jwt.sign({ email: user.email, role: user.role }, 'your_jwt_secret', { expiresIn: '1h' });

    res.status(200).json({ token, user: { email: user.email, role: user.role } });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ message: 'Server Error' });
  }
});


//change password
app.put('/api/users/change-password', async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body;

    if (!email || !currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Email, current password, and new password are required' });
    }

    // Log the email to ensure it's correct
    console.log('Attempting to update password for email:', email);

    // Retrieve user record from Firebase
    const userRecord = await admin.auth().getUserByEmail(email);
    
    if (!userRecord) {
      return res.status(404).json({ message: 'User not found in Firebase' });
    }

    // Log user record details
    console.log('User record found in Firebase:', userRecord);

    // Update password in MongoDB
    await User.findOneAndUpdate(
      { email },
      { password: newPassword }, // Ensure you hash this password if storing in MongoDB
      { new: true }
    );

    // Update password in Firebase
    await admin.auth().updateUser(userRecord.uid, { password: newPassword });

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Error updating password:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});




//Login API Ends Here

//RFID starts here

const rfidHistorySchema = new mongoose.Schema({
  rfidTag: String,
  visitorId: mongoose.Schema.Types.ObjectId,
  name: String,
  GeopicInTime: Date,
  GeopicOutTime: Date,
});

const RfidHistory = mongoose.model('RfidHistory', rfidHistorySchema);
app.post('/api/toggle', async (req, res) => {
  const { rfidTag, name } = req.body;
  try {
    // Find the document in VisitorLocation collection
    let history = await VisitorLocation.findOne({ rfidTag, name });

    if (!history) {
      // If no document is found, create a new one with the entry time
      history = new VisitorLocation({ rfidTag, name, GeopicInTime: new Date() });
      // Also create an entry in the RfidHistory collection
      const newHistory = new RfidHistory({
        rfidTag,
        visitorId: history._id,
        name,
        GeopicInTime: new Date(),
      });
      await newHistory.save();
    } else {
      // If a document is found, check if the entry time is set
      if (history.GeopicInTime && !history.GeopicOutTime) {
        // If entry time is set and exit time is not set, set the exit time
        history.GeopicOutTime = new Date();
        history.location = 'Out of GEOPIC';
        // Update the RfidHistory collection
        await RfidHistory.updateOne(
          { rfidTag, visitorId: history._id, GeopicOutTime: undefined },
          { GeopicOutTime: new Date() }
        );
      } else {
        // If both entry and exit times are set, reset them for a new entry
        history.GeopicInTime = new Date();
        history.location = 'Geopic';
        history.GeopicOutTime = undefined;
        // Create a new entry in the RfidHistory collection
        const newHistory = new RfidHistory({
          rfidTag,
          visitorId: history._id,
          name,
          GeopicInTime: new Date(),
        });
        await newHistory.save();
      }
    }

    // Save the updated or new document in VisitorLocation collection
    await history.save();
    res.status(200).json({ message: 'Time recorded', history });
  } catch (error) {
    res.status(500).json({ message: 'Error recording time', error: error.message });
  }
});

app.get('/api/check_tag', async (req, res) => {
  const tagID = req.query.tagID;

  if (!tagID) {
    return res.json({
      status: 'fail',
      message: 'Tag ID not provided',
    });
  }

  try {
    const visitorLocation = await VisitorLocation.findOne({ rfidTag: tagID.toUpperCase() });

    if (visitorLocation) {
      res.json({
        status: 'success',
        name: visitorLocation.name,
        visiting: visitorLocation.visitingEmployee,
      });
    } else {
      res.json({
        status: 'fail',
        message: 'Tag not recognized',
      });
    }
  } catch (error) {
    console.error(`Error finding visitor with RFID tag ${tagID}:`, error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/api/rfid-history', async (req, res) => {
  try {
    const history = await RfidHistory.find();
    res.json(history);
  } catch (error) {
    console.error('Error fetching RFID history:', error);
    res.status(500).json({ message: 'Error fetching RFID history', error: error.message });
  }
});






app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

