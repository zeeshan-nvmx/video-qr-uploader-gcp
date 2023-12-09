const express = require('express')
const multer = require('multer')
const { Storage } = require('@google-cloud/storage')
const QRCode = require('qrcode')
const path = require('path')

const app = express()
const port = process.env.PORT || 5000

app.use(express.static(path.join(__dirname, 'client/build')))

// Initialize Google Cloud Storage client with your credentials
const storage = new Storage({
  keyFilename: './gcp-credentials.json', // Replace with the path to your service account key file
})

// Create a Cloud Storage bucket reference
const bucketName = 'video-qr-bucket' // Replace with your GCS bucket name
const bucket = storage.bucket(bucketName)

// Multer configuration for handling file uploads
const upload = multer({
  storage: multer.memoryStorage(),
})

app.get('/status', async (req, res) => { 
  res.json({status: "server is up and running successfully"})
})

// Endpoint to upload videos to Google Cloud Storage
app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' })
  }

  const file = bucket.file(req.file.originalname.replace(/\s/g, '-').toLowerCase())

  // Stream the file to Google Cloud Storage
  const stream = file.createWriteStream({
    metadata: {
      contentType: req.file.mimetype,
    },
  })

  stream.on('error', (err) => {
    console.error(err)
    res.status(500).json({ error: err })
  })

  stream.on('finish', () => {
    res.json({ message: 'Video uploaded successfully to Google Cloud Storage' })
  })

  stream.end(req.file.buffer)
})

// Endpoint to fetch all videos from Google Cloud Storage
app.get('/videos', async (req, res) => {
  try {
    const [files] = await bucket.getFiles();
    if (files.length === 0) {
      return res.json([]);
     }
    const videos = files.map((file) => ({
      name: file.name,
      url: `https://storage.googleapis.com/${bucketName}/${file.name}`,
    }));
    res.json(videos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching videos from Google Cloud Storage.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname + '/client/build/index.html'))
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
