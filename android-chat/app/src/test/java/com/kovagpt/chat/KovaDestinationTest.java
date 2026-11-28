package com.kovagpt.chat;

import org.junit.Test;
import static org.junit.Assert.*;

public final class KovaDestinationTest {
    @Test public void validatesFirstPartyOriginBeforeExposingNativeActions() {
        assertTrue(KovaDestination.isTrusted("https://kovagpt.com/images"));
        assertTrue(KovaDestination.isTrusted("https://kovagpt.com:443/"));
        for (String url : new String[]{
            "http://kovagpt.com", "https://kovagpt.com.evil.invalid/",
            "https://user@kovagpt.com/", "https://kovagpt.com:442/",
            "https://kovagpt.com@evil.invalid/", "file:///kovagpt.com", null
        }) assertFalse(url, KovaDestination.isTrusted(url));
    }

    @Test public void shortcutsOnlyResolveToNamedDestinations() {
        assertEquals(KovaDestination.VOICE, KovaDestination.fromShortcut("kovagpt-native://open/voice"));
        assertEquals("https://kovagpt.com/?native_voice=1", KovaDestination.VOICE.url);
        for (String url : new String[]{
            "kovagpt-native://open/voice?token=123", "kovagpt-native://open/voice#extra",
            "kovagpt-native://user@open/voice", "kovagpt-native://open:443/chat",
            "kovagpt-native://open/voice/extra", "kovagpt-native://open/%76oice",
            "https://kovagpt.com/?native_voice=1"
        }) assertNull(url, KovaDestination.fromShortcut(url));
    }
}
