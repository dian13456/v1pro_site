package main

import (
	"flag"
	"log"
	"os"
	"path/filepath"

	"jiadian-hub-backend/service"
)

func main() {
	configDir := flag.String("config", "config", "path to config directory with JSON files")
	flag.Parse()

	paths := service.UserDataPaths{
		LikesPath:     filepath.Join(*configDir, "resource_likes.json"),
		FavoritesPath: filepath.Join(*configDir, "resource_favorites.json"),
		DownloadsPath: filepath.Join(*configDir, "resource_downloads.json"),
		MessagesPath:  filepath.Join(*configDir, "message_board.json"),
		ProfilesPath:  filepath.Join(*configDir, "user_profiles.json"),
		CreditsPath:   filepath.Join(*configDir, "ai_image_credits.json"),
		SharesPath:    filepath.Join(*configDir, "ai_image_share_counts.json"),
	}

	if os.Getenv("STORAGE_BACKEND") == "" {
		_ = os.Setenv("STORAGE_BACKEND", "mysql")
	}
	if os.Getenv("MYSQL_DSN") == "" {
		log.Fatal("请设置 MYSQL_DSN，例如: jiadian:password@tcp(127.0.0.1:3306)/jiadian_hub?charset=utf8mb4&parseTime=true")
	}

	repo, err := service.NewUserDataRepo(paths)
	if err != nil {
		log.Fatalf("connect mysql: %v", err)
	}
	defer repo.Close()

	if err := repo.ImportJSONFiles(); err != nil {
		log.Fatalf("import failed: %v", err)
	}
	log.Println("JSON 数据已成功导入 MySQL")
}
