const express = require('express')
require('dotenv').config()
const multer = require('multer')
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3')
const QRCode = require('qrcode')
const path = require('path')
const fs = require('fs')
const cors = require('cors')

const app = express()
const port = process.env.PORT || 8000

app.use(cors())

// Initialize S3 client for Cloudflare R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

const bucketName = process.env.R2_BUCKET_NAME

// Multer configuration for handling file uploads with disk storage
const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, './uploads')
    },
    filename: function (req, file, cb) {
      cb(null, file.originalname.replace(/\s/g, '-').toLowerCase())
    },
  }),
  limits: {
    fileSize: 1024 * 1024 * 1024 * 5, // Sets the limit to 5GB
  },
})

app.get('/status', async (req, res) => {
  res.json({ status: 'server is up and running successfully' })
})

// Endpoint to upload videos to Cloudflare R2
app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' })
  }

  const fileName = req.file.originalname.replace(/\s/g, '-').toLowerCase()

  try {
    const fileStream = fs.createReadStream(req.file.path)

    const uploadParams = {
      Bucket: bucketName,
      Key: fileName,
      Body: fileStream,
      ContentType: req.file.mimetype,
    }

    await s3Client.send(new PutObjectCommand(uploadParams))

    // Delete the local file after successful upload
    fs.unlink(req.file.path, (unlinkErr) => {
      if (unlinkErr) {
        console.error(unlinkErr)
        return res.status(500).json({ error: unlinkErr })
      }
      // Get the public URL of the uploaded file
      const publicUrl = `${process.env.R2_PUBLIC_DOMAIN}/${fileName}`
      // Respond with success message and URL
      res.json({ message: 'Video uploaded successfully to Cloudflare R2', url: publicUrl })
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error uploading file to Cloudflare R2.' })
  }
})

// Endpoint to fetch all videos from Cloudflare R2
// app.get('/videos', async (req, res) => {
//   try {
//     const listCommand = new ListObjectsV2Command({
//       Bucket: bucketName,
//     })

//     const { Contents = [] } = await s3Client.send(listCommand)

//     if (Contents.length === 0) {
//       return res.json([])
//     }

//     const videos = Contents.map((file) => ({
//       name: file.Key,
//       url: `${process.env.R2_PUBLIC_DOMAIN}/${file.Key}`,
//     }))

//     res.json(videos)
//   } catch (err) {
//     console.error(err)
//     res.status(500).json({ error: 'Error fetching videos from Cloudflare R2.' })
//   }
// })

app.get('/videos', async (req, res) => {
  try {
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
    })

    const { Contents = [] } = await s3Client.send(listCommand)

    if (Contents.length === 0) {
      return res.json([])
    }

    const videos = Contents.sort((a, b) => b.LastModified - a.LastModified) // Sort by LastModified in descending order
      .map((file) => ({
        name: file.Key,
        url: `${process.env.R2_PUBLIC_DOMAIN}/${file.Key}`,
      }))

    res.json(videos)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error fetching videos from Cloudflare R2.' })
  }
})

// // Enhanced endpoint to fetch videos from Cloudflare R2 with pagination
// app.get('/videos-custom', async (req, res) => {
//   try {
//     // Parse pagination parameters from query string
//     const page = parseInt(req.query.page) || 1
//     const limit = parseInt(req.query.limit) || 10

//     // Validate pagination parameters
//     if (page < 1 || limit < 1 || limit > 100) {
//       return res.status(400).json({
//         error: 'Invalid pagination parameters. Page must be >= 1 and limit must be between 1 and 100.',
//       })
//     }

//     // First, get the total count of objects
//     const listCommand = new ListObjectsV2Command({
//       Bucket: bucketName,
//     })

//     const { Contents = [] } = await s3Client.send(listCommand)

//     if (Contents.length === 0) {
//       return res.json({
//         videos: [],
//         pagination: {
//           total: 0,
//           page,
//           limit,
//           totalPages: 0,
//         },
//       })
//     }

//     // Calculate pagination values
//     const startIndex = (page - 1) * limit
//     const endIndex = startIndex + limit
//     const totalItems = Contents.length
//     const totalPages = Math.ceil(totalItems / limit)

//     // Validate requested page
//     if (page > totalPages) {
//       return res.status(400).json({
//         error: `Page ${page} does not exist. Total pages available: ${totalPages}`,
//       })
//     }

//     // Get the paginated subset of videos
//     const paginatedContents = Contents.slice(startIndex, endIndex)

//     // Map the videos with their URLs
//     const videos = paginatedContents.map((file) => ({
//       name: file.Key,
//       url: `${process.env.R2_PUBLIC_DOMAIN}/${file.Key}`
//     }))

//     // Return paginated results with metadata
//     res.json({
//       videos,
//       pagination: {
//         total: totalItems,
//         page,
//         limit,
//         totalPages,
//         hasNextPage: page < totalPages,
//         hasPreviousPage: page > 1,
//       },
//     })
//   } catch (err) {
//     console.error(err)
//     res.status(500).json({ error: 'Error fetching videos from Cloudflare R2.' })
//   }
// })

// Enhanced endpoint to fetch videos from Cloudflare R2 with pagination
app.get('/videos-custom', async (req, res) => {
  try {
    // Parse pagination parameters from query string
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 10

    // Validate pagination parameters
    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({
        error: 'Invalid pagination parameters. Page must be >= 1 and limit must be between 1 and 100.',
      })
    }

    // Fetch all objects from the bucket
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
    })

    const { Contents = [] } = await s3Client.send(listCommand)

    if (Contents.length === 0) {
      return res.json({
        videos: [],
        pagination: {
          total: 0,
          page,
          limit,
          totalPages: 0,
        },
      })
    }

    // Sort by LastModified in descending order (latest first)
    const sortedContents = Contents.sort((a, b) => b.LastModified - a.LastModified)

    // Calculate pagination values
    const totalItems = sortedContents.length
    const totalPages = Math.ceil(totalItems / limit)
    const startIndex = (page - 1) * limit
    const endIndex = startIndex + limit

    // Validate requested page
    if (page > totalPages) {
      return res.status(400).json({
        error: `Page ${page} does not exist. Total pages available: ${totalPages}`,
      })
    }

    // Get the paginated subset of videos after sorting
    const paginatedContents = sortedContents.slice(startIndex, endIndex)

    // Map the videos with their URLs (keeping original format)
    const videos = paginatedContents.map((file) => ({
      name: file.Key,
      url: `${process.env.R2_PUBLIC_DOMAIN}/${file.Key}`
    }))

    // Return paginated results with metadata (keeping original format)
    res.json({
      videos,
      pagination: {
        total: totalItems,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error fetching videos from Cloudflare R2.' })
  }
})

// Endpoint to delete videos from Cloudflare R2
app.delete('/delete/:videoName', async (req, res) => {
  const videoName = req.params.videoName

  if (!videoName) {
    return res.status(400).json({ error: 'Video name not provided.' })
  }

  try {
    // Check if the file exists before attempting to delete
    const headCommand = new HeadObjectCommand({
      Bucket: bucketName,
      Key: videoName,
    })

    try {
      await s3Client.send(headCommand)
    } catch (err) {
      if (err.name === 'NotFound') {
        return res.status(404).json({ error: 'File not found in Cloudflare R2.' })
      }
      throw err
    }

    // Delete the file
    const deleteCommand = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: videoName,
    })

    await s3Client.send(deleteCommand)

    return res.json({ message: 'Video deleted successfully from Cloudflare R2.' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error deleting video from Cloudflare R2.' })
  }
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
