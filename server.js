const express = require('express')
const multer = require('multer')
const { Storage } = require('@google-cloud/storage')
const QRCode = require('qrcode')

const app = express()
const port = process.env.PORT || 3000

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
    res.status(500).json({ error: 'Error uploading the file.' })
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


app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
