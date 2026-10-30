const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

const { testDbConnection } = require("./config/db");
const authRoutes = require("./routes/auth.routes");
const appsRoutes = require("./routes/apps.routes");
const yogifyRoutes = require("./routes/yogify.routes");
const usersRoutes = require("./routes/users.routes");
const { authRequired, pageRoleGuard, ROLES } = require("./middlewares/auth");
const env = require("./config/env");

const app = express();

if (env.nodeEnv === "production") {
  app.set("trust proxy", 1);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return originalJson(body);
  };
  next();
});

app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
      } else if (filePath.endsWith(".css")) {
        res.setHeader("Content-Type", "text/css; charset=utf-8");
      } else if (filePath.endsWith(".js")) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      }
    }
  })
);

app.get("/", (req, res) => {
  return res.redirect("/login.html");
});

app.get("/panel", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "panel.html"));
});

app.get(
  "/panel/users",
  authRequired,
  pageRoleGuard(ROLES.SUPER_ADMIN),
  (_, res) => {
    return res.sendFile(path.join(__dirname, "public", "panel-users.html"));
  }
);

app.get(
  "/apps/new",
  authRequired,
  pageRoleGuard(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  (_, res) => {
    return res.sendFile(path.join(__dirname, "public", "app-new.html"));
  }
);

app.get(
  "/apps/:id/edit",
  authRequired,
  pageRoleGuard(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  (_, res) => {
    return res.sendFile(path.join(__dirname, "public", "app-edit.html"));
  }
);

app.get("/apps/:id/friendify", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-friendify.html"));
});

app.get("/apps/:id/mindcoach", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-mindcoach.html"));
});

app.get("/apps/:id/chatface", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-chatface.html"));
});

app.get("/apps/:id/slim30", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-slim30.html"));
});

app.get("/apps/:id/sixpack30", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-sixpack30.html"));
});

app.get("/apps/:id/breathpath", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-breathpath.html"));
});

app.get("/apps/:id/yogiface", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-yogiface.html"));
});

app.get("/apps/:id/yogify", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-yogify.html"));
});

app.get("/apps/:id/lingolabuddy", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-lingolabuddy.html"));
});

app.get("/apps/:id/live-lingola", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-live-lingola.html"));
});

app.get("/apps/:id/homeworksnap", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-homeworksnap.html"));
});

app.get("/apps/:id/aulix", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-aulix.html"));
});

app.get("/apps/:id/nightflow", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-nightflow.html"));
});

app.get("/apps/:id/menuma", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-menuma.html"));
});

app.get("/apps/:id/slidify", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-slidify.html"));
});

app.get("/apps/:id/smplanner", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-smplanner.html"));
});

app.get("/apps/:id/filetranslate", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-filetranslate.html"));
});

app.get("/apps/:id/videosummary", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-videosummary.html"));
});

app.get("/apps/:id/filechat", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-filechat.html"));
});

app.get("/apps/:id/homifit", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-homifit.html"));
});

app.get("/apps/:id/fitgym", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-fitgym.html"));
});

app.get("/apps/:id/momfit", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-momfit.html"));
});

app.get("/apps/:id/signivo", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-signivo.html"));
});

app.get("/apps/:id/lingolawords", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-lingolawords.html"));
});

app.get("/apps/:id/storylang", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-storylang.html"));
});

app.get("/apps/:id/lingolatravel", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-lingolatravel.html"));
});

app.get("/apps/:id/lingolakids", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-lingolakids.html"));
});

app.get("/apps/:id/storieskids", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-storieskids.html"));
});

app.get("/apps/:id/lingolajob", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-lingolajob.html"));
});

app.get("/apps/:id/dayflow", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-dayflow.html"));
});

app.get("/apps/:id/practigram", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-practigram.html"));
});

app.get("/apps/:id/podora", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-podora.html"));
});

app.get("/apps/:id/logora", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-logora.html"));
});

app.get("/apps/:id/pdfology", authRequired, (_, res) => {
  return res.sendFile(path.join(__dirname, "public", "apps-pdfology.html"));
});

app.use("/api/auth", authRoutes);
app.use("/api/apps/:id/yogify", yogifyRoutes);
app.use("/api/apps", appsRoutes);
app.use("/api/users", usersRoutes);

app.get("/health", (_, res) => {
  return res.json({ ok: true });
});

app.use("/api", (_, res) => {
  return res.status(404).json({ message: "API endpoint bulunamadi." });
});

app.use((_, res) => {
  return res.redirect("/login.html");
});

async function start() {
  try {
    await testDbConnection();
    app.listen(env.port, env.host, () => {
      const publicUrl = env.publicUrl || `http://localhost:${env.port}`;
      console.log(`Server hazir: ${publicUrl}`);
    });
  } catch (error) {
    console.error("DB baglantisi kurulamadi:", error.message);
    process.exit(1);
  }
}

start();
