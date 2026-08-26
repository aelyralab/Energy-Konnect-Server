export function serializeMedia(media) {
  return {
    id: media.id,
    fileName: media.fileName,
    url: media.url,
    mimeType: media.mimeType,
    fileSize: media.fileSize,
    width: media.width,
    height: media.height,
    createdAt: media.createdAt,
  };
}
