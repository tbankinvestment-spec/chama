// controllers/dashboardController.js
// Assembles data for the main Chama dashboard page.
// Pulls live data from MongoDB via services/chamaData.js, with fallback to demo data.

const {
  dashboardStats,
  recentTransactions,
  groupMembers,
} = require("../services/chamaData");

exports.showDashboard = async (req, res) => {
  // authGuard (middlewares/authGuard.js) runs before this handler,
  // so by the time we reach here req.session.user is guaranteed to exist.
  try {
    const user = req.session.user;
    const [stats, transactions, members] = await Promise.all([
      dashboardStats(user),
      recentTransactions(user),
      groupMembers(user),
    ]);

    res.render("dashboard", {
      title: "Dashboard",
      user,
      ...stats,
      transactions,
      members,
    });
  } catch (err) {
    console.error("[Dashboard] Error loading dashboard:", err);
    res.status(500).render("dashboard", {
      title: "Dashboard",
      user: req.session.user,
      totalSavings: 0,
      monthlyTarget: 0,
      thisMonthDeposits: 0,
      activeLoans: 0,
      outstandingLoans: 0,
      memberCount: 0,
      transactions: [],
      members: [],
    });
  }
};
