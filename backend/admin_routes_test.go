package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func adminLoginRequestForTest(t *testing.T, router http.Handler, username, password string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]string{"username": username, "password": password})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestAdminLoginRequiresConfiguredUsernameAndPassword(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("ADMIN_PANEL_USERNAME", "operator")
	t.Setenv("ADMIN_PANEL_PASSWORD", "secret-password")
	router := gin.New()
	registerAdminRoutes(router, "review-token")

	wrongUser := adminLoginRequestForTest(t, router, "admin", "secret-password")
	if wrongUser.Code != http.StatusUnauthorized {
		t.Fatalf("expected wrong username to fail, got %d", wrongUser.Code)
	}
	wrongPassword := adminLoginRequestForTest(t, router, "operator", "wrong")
	if wrongPassword.Code != http.StatusUnauthorized {
		t.Fatalf("expected wrong password to fail, got %d", wrongPassword.Code)
	}
	success := adminLoginRequestForTest(t, router, "operator", "secret-password")
	if success.Code != http.StatusOK {
		t.Fatalf("expected valid login, got %d: %s", success.Code, success.Body.String())
	}
}
