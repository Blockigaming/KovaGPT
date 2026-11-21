package com.kovagpt.chat;

import java.net.URI;
import java.net.URISyntaxException;

enum KovaDestination {
    CHAT("/"),
    VOICE("/?native_voice=1"),
    IMAGES("/images"),
    TASKS("/scheduled-tasks");

    static final String ORIGIN = "https://kovagpt.com";
    final String url;

    KovaDestination(String path) {
        url = "https://kovagpt.com" + path;
    }

    static boolean isTrusted(String value) {
        URI uri = parse(value);
        return uri != null && "https".equals(uri.getScheme()) && "kovagpt.com".equals(uri.getHost())
            && uri.getRawUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    static KovaDestination fromShortcut(String value) {
        URI uri = parse(value);
        if (uri == null || !"kovagpt-native".equals(uri.getScheme()) || !"open".equals(uri.getRawAuthority())
            || uri.getRawQuery() != null || uri.getRawFragment() != null) {
            return null;
        }
        switch (uri.getRawPath()) {
            case "/chat": return CHAT;
            case "/voice": return VOICE;
            case "/images": return IMAGES;
            case "/tasks": return TASKS;
            default: return null;
        }
    }

    private static URI parse(String value) {
        if (value == null) return null;
        try {
            return new URI(value);
        } catch (URISyntaxException invalid) {
            return null;
        }
    }
}
