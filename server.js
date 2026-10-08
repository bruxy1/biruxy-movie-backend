require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const cloudinary = require("cloudinary").v2;

const app = express();

const PORT = process.env.PORT || 10000;

/* =========================
   ADMIN
========================= */

const ADMIN_USER =
  process.env.ADMIN_USER || "shadab";

const ADMIN_PASS =
  process.env.ADMIN_PASS || "biruxy*@786";


/* =========================
   CLOUDINARY
========================= */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});


/* =========================
   DIRECTORIES
========================= */

const TEMP_DIR =
  path.join(__dirname, "temp_uploads");

fs.mkdirSync(TEMP_DIR, {
  recursive: true
});


/* =========================
   MIDDLEWARE
========================= */

app.use(cors());

app.use(
  express.json({
    limit: "2mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);


/* =========================
   ADMIN SESSIONS
========================= */

const sessions = new Set();


/* =========================
   MULTER
========================= */

const upload = multer({
  dest: TEMP_DIR,

  limits: {
    fileSize:
      2 * 1024 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {

    const name =
      String(
        file.originalname || ""
      ).toLowerCase();

    const ext =
      path.extname(name);

    const videoExts = [
      ".mp4",
      ".webm",
      ".ogg",
      ".ogv",
      ".mkv"
    ];

    const imageExts = [
      ".jpg",
      ".jpeg",
      ".png",
      ".webp",
      ".gif"
    ];

    if (
      file.fieldname === "video"
    ) {

      if (
        videoExts.includes(ext)
      ) {
        return cb(null, true);
      }

      return cb(
        new Error(
          "Only MP4, WEBM, OGG, OGV or MKV video files are allowed."
        )
      );
    }


    if (
      file.fieldname === "poster"
    ) {

      if (
        imageExts.includes(ext)
      ) {
        return cb(null, true);
      }

      return cb(
        new Error(
          "Only JPG, JPEG, PNG, WEBP or GIF poster files are allowed."
        )
      );
    }


    cb(
      new Error(
        "Invalid upload field."
      )
    );

  }

});


/* =========================
   HOME / STATUS
========================= */

app.get(
  "/",
  (req, res) => {

    res.json({
      ok: true,
      service:
        "BIRUXY Movie API",
      status:
        "running"
    });

  }
);


/* =========================
   ADMIN LOGIN
========================= */

app.post(
  "/api/admin/login",
  (req, res) => {

    const username =
      String(
        req.body?.username || ""
      );

    const password =
      String(
        req.body?.password || ""
      );


    if (
      username !== ADMIN_USER ||
      password !== ADMIN_PASS
    ) {

      return res
        .status(401)
        .json({
          ok: false,
          error:
            "Wrong admin username or password."
        });

    }


    const token =
      crypto.randomBytes(32)
        .toString("hex");


    sessions.add(token);


    res.json({
      ok: true,
      token
    });

  }
);


/* =========================
   ADMIN AUTH
========================= */

function requireAdmin(
  req,
  res,
  next
) {

  const authorization =
    String(
      req.headers.authorization || ""
    );


  const token =
    authorization.replace(
      /^Bearer\s+/i,
      ""
    );


  if (
    !token ||
    !sessions.has(token)
  ) {

    return res
      .status(401)
      .json({
        error:
          "Admin login required."
      });

  }


  next();

}


/* =========================
   GET MOVIES
========================= */

app.get(
  "/api/movies",
  async (req, res) => {

    try {

      const result =
        await cloudinary.api.resources({
          resource_type: "video",
          type: "upload",
          prefix: "",
          max_results: 100
        });


      const resources =
        result.resources || [];


      const movies =
        resources
          .filter(
            item =>
              item.context &&
              item.context.custom &&
              item.context.custom.biruxy_movie === "true"
          )
          .map(item => {

            const custom =
              item.context.custom;


            return {

              id:
                custom.id ||
                item.public_id,

              title:
                custom.title ||
                item.public_id,

              description:
                custom.description ||
                "",

              category:
                custom.category ||
                "movies",

              poster:
                custom.poster ||
                "",

              video:
                item.secure_url,

              createdAt:
                custom.createdAt ||
                item.created_at

            };

          });


      res.json(movies);

    } catch (error) {

      console.error(
        "GET MOVIES ERROR:",
        error
      );


      res.status(500)
        .json({
          error:
            "Failed to load movies."
        });

    }

  }
);


/* =========================
   ADD MOVIE
========================= */

app.post(
  "/api/movies",

  requireAdmin,

  upload.fields([
    {
      name: "poster",
      maxCount: 1
    },

    {
      name: "video",
      maxCount: 1
    }
  ]),

  async (req, res) => {

    let videoPath = null;
    let posterPath = null;


    try {

      const title =
        String(
          req.body?.title || ""
        ).trim();


      const description =
        String(
          req.body?.description || ""
        ).trim();


      const category =
        String(
          req.body?.category ||
          "movies"
        ).toLowerCase() ===
        "private"
          ? "private"
          : "movies";


      const videoUrl =
        String(
          req.body?.videoUrl || ""
        ).trim();


      const posterUrl =
        String(
          req.body?.posterUrl || ""
        ).trim();


      if (!title) {

        return res
          .status(400)
          .json({
            error:
              "Movie title is required."
          });

      }


      const videoFile =
        req.files?.video?.[0] || null;


      const posterFile =
        req.files?.poster?.[0] || null;


      if (
        !videoUrl &&
        !videoFile
      ) {

        return res
          .status(400)
          .json({
            error:
              "Upload a video or provide a video URL."
          });

      }


      /* =========================
         ID
      ========================= */

      const movieId =
        crypto.randomUUID();


      /* =========================
         POSTER
      ========================= */

      let poster = posterUrl;


      if (posterFile) {

        posterPath =
          posterFile.path;


        const posterResult =
          await cloudinary.uploader.upload(
            posterPath,
            {
              folder:
                "biruxy-movie/posters",

              resource_type:
                "image"
            }
          );


        poster =
          posterResult.secure_url;

      }


      /* =========================
         VIDEO
      ========================= */

      let video = videoUrl;


      if (videoFile) {

        videoPath =
          videoFile.path;


        const videoResult =
          await cloudinary.uploader.upload_large(
            videoPath,
            {
              folder:
                "biruxy-movie/videos",

              resource_type:
                "video",

              chunk_size:
                6000000,

              tags: [
                "biruxy_movie"
              ],

              context: {

                biruxy_movie:
                  "true",

                id:
                  movieId,

                title:
                  title,

                description:
                  description,

                category:
                  category,

                poster:
                  poster,

                createdAt:
                  new Date()
                    .toISOString()

              }
            }
          );


        video =
          videoResult.secure_url;

      }


      /* =========================
         URL-ONLY MOVIE
      ========================= */

      if (!videoFile) {

        // URL based movies are returned
        // through a small response object.
        // Cloudinary is only used when
        // a video file is uploaded.

      }


      const movie = {

        id:
          movieId,

        title:
          title,

        description:
          description,

        category:
          category,

        poster:
          poster,

        video:
          video,

        createdAt:
          new Date()
            .toISOString()

      };


      res.json({
        ok: true,
        movie
      });


    } catch (error) {

      console.error(
        "ADD MOVIE ERROR:",
        error
      );


      res.status(500)
        .json({
          error:
            error.message ||
            "Failed to add movie."
        });


    } finally {

      /* =========================
         DELETE TEMP FILES
      ========================= */

      try {

        if (
          videoPath &&
          fs.existsSync(videoPath)
        ) {

          fs.unlinkSync(
            videoPath
          );

        }

      } catch (error) {}


      try {

        if (
          posterPath &&
          fs.existsSync(posterPath)
        ) {

          fs.unlinkSync(
            posterPath
          );

        }

      } catch (error) {}

    }

  }
);


/* =========================
   DELETE MOVIE
========================= */

app.delete(
  "/api/movies/:id",

  requireAdmin,

  async (req, res) => {

    try {

      const movieId =
        String(
          req.params.id || ""
        ).trim();


      if (!movieId) {

        return res
          .status(400)
          .json({
            error:
              "Movie ID is required."
          });

      }


      const result =
        await cloudinary.api.resources({
          resource_type:
            "video",

          type:
            "upload",

          prefix: "",

          max_results:
            100
        });


      const resources =
        result.resources || [];


      const movie =
        resources.find(
          item =>
            item.context &&
            item.context.custom &&
            item.context.custom.biruxy_movie === "true" &&
            item.context.custom.id === movieId
        );


      if (!movie) {

        return res
          .status(404)
          .json({
            error:
              "Movie not found."
          });

      }


      await cloudinary.uploader.destroy(
        movie.public_id,
        {
          resource_type:
            "video"
        }
      );


      const poster =
        movie.context?.custom?.poster ||
        "";


      res.json({
        ok: true
      });


    } catch (error) {

      console.error(
        "DELETE MOVIE ERROR:",
        error
      );


      res.status(500)
        .json({
          error:
            "Delete failed."
        });

    }

  }
);


/* =========================
   404
========================= */

app.use(
  (req, res) => {

    res
      .status(404)
      .json({
        error:
          "API route not found."
      });

  }
);


/* =========================
   ERROR HANDLER
========================= */

app.use(
  (error, req, res, next) => {

    console.error(
      "SERVER ERROR:",
      error
    );


    if (
      error instanceof
      multer.MulterError
    ) {

      return res
        .status(400)
        .json({
          error:
            "Upload error: " +
            error.message
        });

    }


    res
      .status(500)
      .json({
        error:
          error.message ||
          "Internal server error."
      });

  }
);


/* =========================
   START
========================= */

app.listen(
  PORT,
  () => {

    console.log(
      "================================"
    );

    console.log(
      "BIRUXY Movie API running"
    );

    console.log(
      "PORT:",
      PORT
    );

    console.log(
      "================================"
    );

  }
);