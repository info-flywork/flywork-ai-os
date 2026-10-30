const env = require("../config/env");

function resolvePanelApiKey(app) {
  const fromApp = app?.panelApiKey?.trim();
  if (fromApp) return fromApp;

  if (app?.panelSlug === "friendify" && env.friendifyPanelApiKey) {
    return env.friendifyPanelApiKey;
  }

  if (app?.panelSlug === "mindcoach" && env.mindcoachPanelApiKey) {
    return env.mindcoachPanelApiKey;
  }

  if (app?.panelSlug === "chatface" && env.chatfacePanelApiKey) {
    return env.chatfacePanelApiKey;
  }

  if (app?.panelSlug === "slim30" && env.slim30PanelApiKey) {
    return env.slim30PanelApiKey;
  }

  if (app?.panelSlug === "sixpack30" && env.sixpack30PanelApiKey) {
    return env.sixpack30PanelApiKey;
  }

  if (app?.panelSlug === "breathpath" && env.breathpathPanelApiKey) {
    return env.breathpathPanelApiKey;
  }

  if (app?.panelSlug === "yogiface" && env.yogifacePanelApiKey) {
    return env.yogifacePanelApiKey;
  }

  if (app?.panelSlug === "lingolabuddy" && env.lingolabuddyPanelApiKey) {
    return env.lingolabuddyPanelApiKey;
  }

  if (app?.panelSlug === "live-lingola" && env.liveLingolaPanelApiKey) {
    return env.liveLingolaPanelApiKey;
  }

  if (app?.panelSlug === "homeworksnap" && env.homeworksnapPanelApiKey) {
    return env.homeworksnapPanelApiKey;
  }

  if (app?.panelSlug === "aulix" && env.aulixPanelApiKey) {
    return env.aulixPanelApiKey;
  }

  if (app?.panelSlug === "nightflow" && env.nightflowPanelApiKey) {
    return env.nightflowPanelApiKey;
  }

  if (app?.panelSlug === "menuma" && env.menumaPanelApiKey) {
    return env.menumaPanelApiKey;
  }

  if (app?.panelSlug === "slidify" && env.slidifyPanelApiKey) {
    return env.slidifyPanelApiKey;
  }

  if (app?.panelSlug === "smplanner" && env.smplannerPanelApiKey) {
    return env.smplannerPanelApiKey;
  }

  if (app?.panelSlug === "filetranslate" && env.filetranslatePanelApiKey) {
    return env.filetranslatePanelApiKey;
  }

  if (app?.panelSlug === "videosummary" && env.videosummaryPanelApiKey) {
    return env.videosummaryPanelApiKey;
  }

  if (app?.panelSlug === "filechat" && env.filechatPanelApiKey) {
    return env.filechatPanelApiKey;
  }

  if (app?.panelSlug === "homifit" && env.homifitPanelApiKey) {
    return env.homifitPanelApiKey;
  }

  if (app?.panelSlug === "fitgym" && env.fitgymPanelApiKey) {
    return env.fitgymPanelApiKey;
  }

  if (app?.panelSlug === "momfit" && env.momfitPanelApiKey) {
    return env.momfitPanelApiKey;
  }

  if (app?.panelSlug === "signivo" && env.signivoPanelApiKey) {
    return env.signivoPanelApiKey;
  }

  if (app?.panelSlug === "lingolawords" && env.lingolawordsPanelApiKey) {
    return env.lingolawordsPanelApiKey;
  }

  if (app?.panelSlug === "storylang" && env.storylangPanelApiKey) {
    return env.storylangPanelApiKey;
  }

  if (app?.panelSlug === "lingolatravel" && env.lingolatravelPanelApiKey) {
    return env.lingolatravelPanelApiKey;
  }

  if (app?.panelSlug === "lingolakids" && env.lingolakidsPanelApiKey) {
    return env.lingolakidsPanelApiKey;
  }

  if (app?.panelSlug === "storieskids" && env.storieskidsPanelApiKey) {
    return env.storieskidsPanelApiKey;
  }

  if (app?.panelSlug === "lingolajob" && env.lingolajobPanelApiKey) {
    return env.lingolajobPanelApiKey;
  }
  if (app?.panelSlug === "dayflow" && env.dayflowPanelApiKey) {
    return env.dayflowPanelApiKey;
  }
  if (app?.panelSlug === "practigram" && env.practigramPanelApiKey) {
    return env.practigramPanelApiKey;
  }
  if (app?.panelSlug === "podora" && env.podoraPanelApiKey) {
    return env.podoraPanelApiKey;
  }
  if (app?.panelSlug === "logora" && env.logoraPanelApiKey) {
    return env.logoraPanelApiKey;
  }
  if (app?.panelSlug === "pdfology" && env.pdfologyPanelApiKey) {
    return env.pdfologyPanelApiKey;
  }

  return null;
}

function buildPanelHeaders(app) {
  const key = resolvePanelApiKey(app);
  if (!key) return {};

  if (app?.panelSlug === "chatface" || app?.panelSlug === "slim30") {
    return { "X-Panel-Key": key };
  }

  const headers = { "x-panel-api-key": key };
  if (
    app?.panelSlug === "mindcoach" ||
    app?.panelSlug === "sixpack30" ||
    app?.panelSlug === "breathpath" ||
    app?.panelSlug === "yogiface" ||
    app?.panelSlug === "lingolabuddy" ||
    app?.panelSlug === "live-lingola" ||
    app?.panelSlug === "homeworksnap" ||
    app?.panelSlug === "aulix" ||
    app?.panelSlug === "nightflow" ||
    app?.panelSlug === "menuma" ||
    app?.panelSlug === "slidify" ||
    app?.panelSlug === "smplanner" ||
    app?.panelSlug === "filetranslate" ||
    app?.panelSlug === "videosummary" ||
    app?.panelSlug === "filechat" ||
    app?.panelSlug === "homifit" ||
    app?.panelSlug === "fitgym" ||
    app?.panelSlug === "momfit" ||
    app?.panelSlug === "signivo" ||
    app?.panelSlug === "lingolawords" ||
    app?.panelSlug === "storylang" ||
    app?.panelSlug === "lingolatravel" ||
    app?.panelSlug === "lingolakids" ||
    app?.panelSlug === "storieskids" ||
    app?.panelSlug === "lingolajob" ||
    app?.panelSlug === "dayflow" ||
    app?.panelSlug === "practigram" ||
    app?.panelSlug === "podora" ||
    app?.panelSlug === "logora" ||
    app?.panelSlug === "pdfology"
  ) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

module.exports = {
  resolvePanelApiKey,
  buildPanelHeaders
};
