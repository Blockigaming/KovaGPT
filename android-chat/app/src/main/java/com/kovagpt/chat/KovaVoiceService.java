package com.kovagpt.chat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

public final class KovaVoiceService extends Service {
    static final String STATE = "com.kovagpt.chat.VOICE_SERVICE_STATE";
    static final String ID = "voice_id";
    static final String RUNNING = "running";
    private static final String STOP = "com.kovagpt.chat.STOP_VOICE";
    private static final String CHANNEL = "voice_conversations";
    private static final int NOTIFICATION = 840;

    private String id;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String requested = intent.getStringExtra(ID);
        if (STOP.equals(intent.getAction())) {
            if (requested != null && requested.equals(id)) stopSelf();
            return START_NOT_STICKY;
        }
        if (id != null && !id.equals(requested)) publish(id, false);
        id = requested;
        try {
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(new NotificationChannel(
                CHANNEL, "Voice conversations", NotificationManager.IMPORTANCE_LOW));
            PendingIntent stop = PendingIntent.getService(this, 0,
                new Intent(this, KovaVoiceService.class).setAction(STOP).putExtra(ID, id),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, KovaChatActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification notification = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("KovaGPT Voice is active")
                .setContentText("Tap Stop Voice to end the conversation.")
                .setContentIntent(open)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(null, "Stop Voice", stop).build())
                .build();
            if (Build.VERSION.SDK_INT >= 30)
                startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(NOTIFICATION, notification);
            publish(id, true);
        } catch (RuntimeException unavailable) {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        publish(id, false);
        super.onDestroy();
    }

    private void publish(String voiceId, boolean running) {
        if (voiceId != null)
            sendBroadcast(new Intent(STATE).setPackage(getPackageName())
                .putExtra(ID, voiceId).putExtra(RUNNING, running));
    }
}
