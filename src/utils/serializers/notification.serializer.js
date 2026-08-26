export function serializeNotification(notification) {
  return {
    id: notification.id,
    type: notification.type,
    articleId: notification.articleId,
    title: notification.title,
    message: notification.message,
    isRead: notification.isRead,
    createdAt: notification.createdAt,
  };
}
