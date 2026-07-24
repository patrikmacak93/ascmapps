module.exports = {
    DB_SERVER: process.env.DB_SERVER,
    DB_DATABASE: process.env.DB_DATABASE,
    API_KEY: process.env.API_KEY,
    PORT: process.env.PORT || 4000,
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    NODE_ENV: process.env.NODE_ENV,
    ODBC_DRIVER: process.env.ODBC_DRIVER || "ODBC Driver 17 for SQL Server",
}