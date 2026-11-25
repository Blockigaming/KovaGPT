import Foundation

for destination in KovaDestination.allCases {
    precondition(KovaDestination(shortcutURL: destination.shortcutURL) == destination)
    precondition(KovaDestination.isTrusted(destination.url))
}
precondition(KovaDestination.voice.url.absoluteString == "https://kovagpt.com/?native_voice=1")
for unsafe in [
    "http://kovagpt.com", "https://kovagpt.com:444", "https://someone@kovagpt.com",
    "https://kovagpt.com.evil.invalid", "https://kovagpt.com@evil.invalid", "file:///kovagpt.com"
] {
    precondition(!KovaDestination.isTrusted(URL(string: unsafe)))
}
for unsafe in [
    "kovagpt-native://open/voice?token=123", "kovagpt-native://open/voice#extra",
    "kovagpt-native://user@open/voice", "kovagpt-native://open:443/voice",
    "kovagpt-native://open/voice/extra", "kovagpt-native://open/%76oice",
    "kovagpt-native://open/not-a-destination"
] {
    precondition(KovaDestination(shortcutURL: URL(string: unsafe)!) == nil)
}

 
// iOS is an assistant, not a browser for Kova's marketing site.
for path in ["/pricing", "/subscribe", "/download", "/changelog", "/features/chat", "/business/learn", "/en/home"] {
    precondition(KovaDestination.isWebsiteOnly(URL(string: "https://kovagpt.com" + path)), "Expected website-only: " + path)
}
for path in ["/", "/projects", "/library", "/images", "/apps", "/scheduled-tasks", "/login", "/signup", "/privacy", "/terms", "/help", "/api/auth/google/exchange"] {
    precondition(!KovaDestination.isWebsiteOnly(URL(string: "https://kovagpt.com" + path)), "Expected workspace or account: " + path)
}
precondition(!KovaDestination.isWebsiteOnly(URL(string: "https://untrusted.example/pricing")))
