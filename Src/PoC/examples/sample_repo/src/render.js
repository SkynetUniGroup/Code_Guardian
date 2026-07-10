function renderComment(el, comment) {
  el.innerHTML = "<p>" + comment.body + "</p>";
}

/**
 * Formatta una data in ISO 8601.
 * @param {Date} d
 * @returns {string}
 */
function formatDate(d) {
  return d.toISOString();
}

export class CommentList {
  constructor(items) {
    this.items = items;
  }
}
