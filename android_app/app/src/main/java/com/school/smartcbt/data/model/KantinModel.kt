package com.school.smartcbt.data.model

data class KantinDashboardResponse(
    val success: Boolean? = false,
    val message: String? = null,
    val todayDate: String? = null,
    val totalRevenueToday: Double? = 0.0,
    val totalTransactionsToday: Int? = 0,
    val recentOrders: List<KantinOrderItem>? = null
)

data class KantinOrderItem(
    val id: String? = null,
    val studentId: String? = null,
    val studentName: String? = null,
    val className: String? = null,
    val standName: String? = null,
    val amount: Double? = 0.0,
    val notes: String? = null,
    val date: String? = null,
    val time: String? = null
)

data class KantinPaymentResponse(
    val success: Boolean? = false,
    val message: String? = null,
    val transactionId: String? = null,
    val student: KantinStudentInfo? = null,
    val amount: Double? = 0.0,
    val remainingBalance: Double? = null,
    val remainingDailyLimit: Double? = null
)

data class KantinStudentInfo(
    val id: String? = null,
    val name: String? = null,
    val className: String? = null
)
