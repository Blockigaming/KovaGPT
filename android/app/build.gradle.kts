plugins {
    id("com.android.application") version "8.10.1"
    id("org.jetbrains.kotlin.android") version "2.1.21"
}

val stagingHost = providers.gradleProperty("kovaHealthStagingHost").orNull
val approvedStagingHost = Regex("ca-kovagpt-staging\\.[a-z0-9-]+\\.[a-z0-9-]+\\.azurecontainerapps\\.io")
require(stagingHost == null || stagingHost == "staging.kovagpt.com" || approvedStagingHost.matches(stagingHost)) {
    "kovaHealthStagingHost must be the approved Kova staging host without a scheme or path"
}

android {
    namespace = "com.kovagpt.health"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.kovagpt.health"
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "HEALTH_WEB_HOST", "\"kovagpt.com\"")
    }
    buildFeatures { buildConfig = true }
    buildTypes {
        debug {
            if (stagingHost != null) {
                applicationIdSuffix = ".staging"
                buildConfigField("String", "HEALTH_WEB_HOST", "\"$stagingHost\"")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.1")
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("androidx.webkit:webkit:1.13.0")
}
