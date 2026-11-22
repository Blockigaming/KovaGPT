plugins {
    id("com.android.application") version "8.10.1"
    id("org.jetbrains.kotlin.android") version "2.1.21"
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
