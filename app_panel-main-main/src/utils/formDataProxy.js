/**
 * Express multer → harici API FormData iletimi
 */
function appendField(formData, key, value) {
  if (value == null) return;
  const str = String(value);
  if (str === "") return;
  formData.append(key, str);
}

function appendFile(formData, file) {
  if (!file?.buffer?.length) return;
  const blob = new Blob([file.buffer], { type: file.mimetype || "application/octet-stream" });
  formData.append(file.fieldname, blob, file.originalname || file.fieldname);
}

function buildFormDataFromRequest(req) {
  const formData = new FormData();

  for (const [key, value] of Object.entries(req.body || {})) {
    if (Array.isArray(value)) {
      value.forEach((v) => appendField(formData, key, v));
    } else {
      appendField(formData, key, value);
    }
  }

  const files = req.files;
  if (Array.isArray(files)) {
    files.forEach((file) => appendFile(formData, file));
  } else if (files && typeof files === "object") {
    for (const entry of Object.values(files)) {
      const list = Array.isArray(entry) ? entry : [entry];
      list.forEach((file) => appendFile(formData, file));
    }
  }

  return formData;
}

function requestHasMultipartFiles(req) {
  const files = req.files;
  if (Array.isArray(files)) return files.length > 0;
  if (!files || typeof files !== "object") return false;
  return Object.values(files).some((f) => (Array.isArray(f) ? f.length : f));
}

module.exports = {
  buildFormDataFromRequest,
  requestHasMultipartFiles
};
