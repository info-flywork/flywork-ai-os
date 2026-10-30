const env = require("../config/env");

function normalizeProjectId(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function resolveRevenueCatProjectId(app) {
  const fromApp = normalizeProjectId(app?.revenuecatProjectId);
  if (fromApp) return fromApp;

  const slug = app?.panelSlug;
  if (slug === "friendify" && env.friendifyRevenuecatProjectId) {
    return env.friendifyRevenuecatProjectId;
  }
  if (slug === "mindcoach" && env.mindcoachRevenuecatProjectId) {
    return env.mindcoachRevenuecatProjectId;
  }
  if (slug === "chatface" && env.chatfaceRevenuecatProjectId) {
    return env.chatfaceRevenuecatProjectId;
  }
  if (slug === "slim30" && env.slim30RevenuecatProjectId) {
    return env.slim30RevenuecatProjectId;
  }
  if (slug === "sixpack30" && env.sixpack30RevenuecatProjectId) {
    return env.sixpack30RevenuecatProjectId;
  }
  if (slug === "breathpath" && env.breathpathRevenuecatProjectId) {
    return env.breathpathRevenuecatProjectId;
  }
  if (slug === "yogiface" && env.yogifaceRevenuecatProjectId) {
    return env.yogifaceRevenuecatProjectId;
  }
  if (slug === "lingolabuddy" && env.lingolabuddyRevenuecatProjectId) {
    return env.lingolabuddyRevenuecatProjectId;
  }
  if (slug === "live-lingola" && env.liveLingolaRevenuecatProjectId) {
    return env.liveLingolaRevenuecatProjectId;
  }
  if (slug === "homeworksnap" && env.homeworksnapRevenuecatProjectId) {
    return env.homeworksnapRevenuecatProjectId;
  }
  if (slug === "aulix" && env.aulixRevenuecatProjectId) {
    return env.aulixRevenuecatProjectId;
  }
  if (slug === "nightflow" && env.nightflowRevenuecatProjectId) {
    return env.nightflowRevenuecatProjectId;
  }
  if (slug === "menuma" && env.menumaRevenuecatProjectId) {
    return env.menumaRevenuecatProjectId;
  }
  if (slug === "slidify" && env.slidifyRevenuecatProjectId) {
    return env.slidifyRevenuecatProjectId;
  }
  if (slug === "smplanner" && env.smplannerRevenuecatProjectId) {
    return env.smplannerRevenuecatProjectId;
  }
  if (slug === "filetranslate" && env.filetranslateRevenuecatProjectId) {
    return env.filetranslateRevenuecatProjectId;
  }
  if (slug === "videosummary" && env.videosummaryRevenuecatProjectId) {
    return env.videosummaryRevenuecatProjectId;
  }
  if (slug === "filechat" && env.filechatRevenuecatProjectId) {
    return env.filechatRevenuecatProjectId;
  }
  if (slug === "homifit" && env.homifitRevenuecatProjectId) {
    return env.homifitRevenuecatProjectId;
  }
  if (slug === "fitgym" && env.fitgymRevenuecatProjectId) {
    return env.fitgymRevenuecatProjectId;
  }
  if (slug === "momfit" && env.momfitRevenuecatProjectId) {
    return env.momfitRevenuecatProjectId;
  }
  if (slug === "signivo" && env.signivoRevenuecatProjectId) {
    return env.signivoRevenuecatProjectId;
  }
  if (slug === "lingolawords" && env.lingolawordsRevenuecatProjectId) {
    return env.lingolawordsRevenuecatProjectId;
  }
  if (slug === "storylang" && env.storylangRevenuecatProjectId) {
    return env.storylangRevenuecatProjectId;
  }
  if (slug === "lingolatravel" && env.lingolatravelRevenuecatProjectId) {
    return env.lingolatravelRevenuecatProjectId;
  }
  if (slug === "lingolakids" && env.lingolakidsRevenuecatProjectId) {
    return env.lingolakidsRevenuecatProjectId;
  }
  if (slug === "storieskids" && env.storieskidsRevenuecatProjectId) {
    return env.storieskidsRevenuecatProjectId;
  }
  if (slug === "lingolajob" && env.lingolajobRevenuecatProjectId) {
    return env.lingolajobRevenuecatProjectId;
  }
  if (slug === "dayflow" && env.dayflowRevenuecatProjectId) {
    return env.dayflowRevenuecatProjectId;
  }
  if (slug === "practigram" && env.practigramRevenuecatProjectId) {
    return env.practigramRevenuecatProjectId;
  }
  if (slug === "podora" && env.podoraRevenuecatProjectId) {
    return env.podoraRevenuecatProjectId;
  }
  if (slug === "logora" && env.logoraRevenuecatProjectId) {
    return env.logoraRevenuecatProjectId;
  }
  if (slug === "pdfology" && env.pdfologyRevenuecatProjectId) {
    return env.pdfologyRevenuecatProjectId;
  }

  return null;
}

function resolveRevenueCatApiKey(app) {
  const slug = app?.panelSlug;
  if (slug === "friendify" && env.friendifyRevenuecatApiKey) {
    return env.friendifyRevenuecatApiKey;
  }
  if (slug === "mindcoach" && env.mindcoachRevenuecatApiKey) {
    return env.mindcoachRevenuecatApiKey;
  }
  if (slug === "chatface" && env.chatfaceRevenuecatApiKey) {
    return env.chatfaceRevenuecatApiKey;
  }
  if (slug === "slim30" && env.slim30RevenuecatApiKey) {
    return env.slim30RevenuecatApiKey;
  }
  if (slug === "sixpack30" && env.sixpack30RevenuecatApiKey) {
    return env.sixpack30RevenuecatApiKey;
  }
  if (slug === "breathpath" && env.breathpathRevenuecatApiKey) {
    return env.breathpathRevenuecatApiKey;
  }
  if (slug === "yogiface" && env.yogifaceRevenuecatApiKey) {
    return env.yogifaceRevenuecatApiKey;
  }
  if (slug === "lingolabuddy" && env.lingolabuddyRevenuecatApiKey) {
    return env.lingolabuddyRevenuecatApiKey;
  }
  if (slug === "live-lingola" && env.liveLingolaRevenuecatApiKey) {
    return env.liveLingolaRevenuecatApiKey;
  }
  if (slug === "homeworksnap" && env.homeworksnapRevenuecatApiKey) {
    return env.homeworksnapRevenuecatApiKey;
  }
  if (slug === "aulix" && env.aulixRevenuecatApiKey) {
    return env.aulixRevenuecatApiKey;
  }
  if (slug === "nightflow" && env.nightflowRevenuecatApiKey) {
    return env.nightflowRevenuecatApiKey;
  }
  if (slug === "menuma" && env.menumaRevenuecatApiKey) {
    return env.menumaRevenuecatApiKey;
  }
  if (slug === "slidify" && env.slidifyRevenuecatApiKey) {
    return env.slidifyRevenuecatApiKey;
  }
  if (slug === "smplanner" && env.smplannerRevenuecatApiKey) {
    return env.smplannerRevenuecatApiKey;
  }
  if (slug === "filetranslate" && env.filetranslateRevenuecatApiKey) {
    return env.filetranslateRevenuecatApiKey;
  }
  if (slug === "videosummary" && env.videosummaryRevenuecatApiKey) {
    return env.videosummaryRevenuecatApiKey;
  }
  if (slug === "filechat" && env.filechatRevenuecatApiKey) {
    return env.filechatRevenuecatApiKey;
  }
  if (slug === "homifit" && env.homifitRevenuecatApiKey) {
    return env.homifitRevenuecatApiKey;
  }
  if (slug === "fitgym" && env.fitgymRevenuecatApiKey) {
    return env.fitgymRevenuecatApiKey;
  }
  if (slug === "momfit" && env.momfitRevenuecatApiKey) {
    return env.momfitRevenuecatApiKey;
  }
  if (slug === "signivo" && env.signivoRevenuecatApiKey) {
    return env.signivoRevenuecatApiKey;
  }
  if (slug === "lingolawords" && env.lingolawordsRevenuecatApiKey) {
    return env.lingolawordsRevenuecatApiKey;
  }
  if (slug === "storylang" && env.storylangRevenuecatApiKey) {
    return env.storylangRevenuecatApiKey;
  }
  if (slug === "lingolatravel" && env.lingolatravelRevenuecatApiKey) {
    return env.lingolatravelRevenuecatApiKey;
  }
  if (slug === "lingolakids" && env.lingolakidsRevenuecatApiKey) {
    return env.lingolakidsRevenuecatApiKey;
  }
  if (slug === "storieskids" && env.storieskidsRevenuecatApiKey) {
    return env.storieskidsRevenuecatApiKey;
  }
  if (slug === "lingolajob" && env.lingolajobRevenuecatApiKey) {
    return env.lingolajobRevenuecatApiKey;
  }
  if (slug === "dayflow" && env.dayflowRevenuecatApiKey) {
    return env.dayflowRevenuecatApiKey;
  }
  if (slug === "practigram" && env.practigramRevenuecatApiKey) {
    return env.practigramRevenuecatApiKey;
  }
  if (slug === "podora" && env.podoraRevenuecatApiKey) {
    return env.podoraRevenuecatApiKey;
  }
  if (slug === "logora" && env.logoraRevenuecatApiKey) {
    return env.logoraRevenuecatApiKey;
  }
  if (slug === "pdfology" && env.pdfologyRevenuecatApiKey) {
    return env.pdfologyRevenuecatApiKey;
  }

  const key = env.revenuecatApiKey?.trim();
  return key || null;
}

function hasRevenueCatConfig(app) {
  return Boolean(resolveRevenueCatApiKey(app) && resolveRevenueCatProjectId(app));
}

module.exports = {
  resolveRevenueCatProjectId,
  resolveRevenueCatApiKey,
  hasRevenueCatConfig
};
