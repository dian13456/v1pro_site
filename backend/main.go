package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"jiadian-hub-backend/service"
)

type resourceMap map[string]string

func loadResourceMap(path string) (resourceMap, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var m resourceMap
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func main() {
	cosBucket := os.Getenv("COS_BUCKET")
	cosRegion := os.Getenv("COS_REGION")
	cosSecretID := os.Getenv("COS_SECRET_ID")
	cosSecretKey := os.Getenv("COS_SECRET_KEY")
	resourceMapPath := os.Getenv("RESOURCE_MAP_PATH")
	if resourceMapPath == "" {
		resourceMapPath = filepath.Join("config", "resource_map.json")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mapping, err := loadResourceMap(resourceMapPath)
	if err != nil {
		log.Fatalf("load resource map failed: %v", err)
	}

	signer, err := service.NewCOSSigner(cosBucket, cosRegion, cosSecretID, cosSecretKey)
	if err != nil {
		log.Fatalf("init cos signer failed: %v", err)
	}

	router := gin.Default()

	handleResource := func(c *gin.Context, id string) {
		objectKey, ok := mapping[id]
		if !ok || objectKey == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
			return
		}

		url, signErr := signer.GenerateReadURL(c.Request.Context(), objectKey, 10*time.Minute)
		if signErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "sign url failed"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"url": url})
	}

	router.GET("/api/resource/:id", func(c *gin.Context) {
		handleResource(c, c.Param("id"))
	})
	router.GET("/api/resource/", func(c *gin.Context) {
		handleResource(c, c.Query("id"))
	})

	if err := router.Run(":" + port); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server run failed: %v", err)
	}
}
