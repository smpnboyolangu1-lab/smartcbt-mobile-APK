# Proguard Rules for Smart CBT Android App

# 1. Keep all data models and DTOs (used by Gson & Retrofit)
-keep class com.school.smartcbt.data.model.** { *; }
-keep class com.school.smartcbt.data.remote.** { *; }
-keep class com.school.smartcbt.data.local.** { *; }
-keep class * implements java.io.Serializable { *; }

# 2. Keep Retrofit & OkHttp
-dontwarn retrofit2.**
-keep class retrofit2.** { *; }
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeInvisibleAnnotations
-keepattributes RuntimeVisibleParameterAnnotations, RuntimeInvisibleParameterAnnotations

-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# 3. Keep Gson
-keepattributes *Annotation*
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
-keep class com.google.gson.** { *; }

# 4. Keep Room Database
-keep class androidx.room.** { *; }
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class * { *; }
-keep @androidx.room.Dao class * { *; }
-dontwarn androidx.room.paging.**

# 5. Keep ML Kit & Google Play Services
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.mlkit.**
-dontwarn com.google.android.gms.**

# 6. Keep CameraX
-keep class androidx.camera.** { *; }
-dontwarn androidx.camera.**

# 7. Keep ViewBinding
-keep class com.school.smartcbt.databinding.** { *; }

# 8. Keep Coroutines
-keep class kotlinx.coroutines.** { *; }
-dontwarn kotlinx.coroutines.**

# 9. Keep Firebase & Push Notifications
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# 10. Keep Native JNI Methods
-keepclasseswithmembernames class * {
    native <methods>;
}
