package com.kovagpt.chat;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class KovaPushService extends FirebaseMessagingService {
    private static final int TASK_NOTIFICATION = 1;

    @Override
    public void onMessageReceived(RemoteMessage message) {
        if (!"scheduled_task_completed".equals(message.getData().get("kind"))) return;
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return;

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return;
        String channel = KovaChatActivity.TASKS_CHANNEL;
        manager.createNotificationChannel(new NotificationChannel(
                channel, "Scheduled tasks", NotificationManager.IMPORTANCE_DEFAULT));

        Intent destination = new Intent(this, KovaChatActivity.class)
                .setData(Uri.parse("kovagpt-native://open/tasks"))
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openTasks = PendingIntent.getActivity(
                this, 0, destination, PendingIntent.FLAG_IMMUTABLE);
        // Keep account and task content out of shared lock screens.
        Notification notification = new Notification.Builder(this, channel)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("KovaGPT")
                .setContentText("A scheduled task has finished.")
                .setContentIntent(openTasks)
                .setAutoCancel(true)
                .build();
        manager.notify(TASK_NOTIFICATION, notification);
    }
}
