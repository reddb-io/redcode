function avatarImageVisible(src, failedSrc) {
  return Boolean(src) && src !== failedSrc;
}
function avatarImageFailed(image) {
  return Boolean(image?.complete && image.naturalWidth === 0);
}
export {
  avatarImageFailed,
  avatarImageVisible
};
