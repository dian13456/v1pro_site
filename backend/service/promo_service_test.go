package service

import "testing"

func TestPromoApplicantCanViewAndCorrectSubmissionBeforeApproval(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "json")
	repo, err := NewPromoRepo(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = repo.Close() })

	service := NewPromoService(repo, "test-jwt-secret")
	created, err := service.Submit("SN-OWNER", PromoSubmissionInput{
		CampaignID:         PromoCampaignCNCRrepurchase,
		OrderNo:            "ORDER-OLD",
		OrderScreenshotURL: "https://example.com/old.png",
		InjectionColorNote: "white",
		ShippingAddress:    "old address",
	})
	if err != nil {
		t.Fatalf("submit: %v", err)
	}

	detail, err := service.GetMySubmission("SN-OWNER")
	if err != nil {
		t.Fatalf("get own submission: %v", err)
	}
	if detail.ShippingAddress != "old address" || detail.OrderNo != "ORDER-OLD" {
		t.Fatalf("unexpected decrypted detail: %#v", detail)
	}

	if _, err := service.ReviewSubmission(created.ID, PromoStatusRejected, "please correct it"); err != nil {
		t.Fatalf("reject: %v", err)
	}
	updated, err := service.UpdateSubmission("SN-OWNER", PromoSubmissionInput{
		CampaignID:         PromoCampaignCNCRrepurchase,
		OrderNo:            "ORDER-NEW",
		OrderScreenshotURL: "https://example.com/new.png",
		InjectionColorNote: "black",
		ShippingAddress:    "new address",
	})
	if err != nil {
		t.Fatalf("update rejected submission: %v", err)
	}
	if updated.Status != PromoStatusPending {
		t.Fatalf("status = %q, want pending", updated.Status)
	}
	if updated.AdminNote != "" {
		t.Fatalf("old admin note was not cleared: %q", updated.AdminNote)
	}
	if updated.OrderNo != "ORDER-NEW" || updated.ShippingAddress != "new address" {
		t.Fatalf("updated values not returned: %#v", updated)
	}

	if _, err := service.ReviewSubmission(created.ID, PromoStatusApproved, "ok"); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if _, err := service.UpdateSubmission("SN-OWNER", PromoSubmissionInput{
		CampaignID:         PromoCampaignCNCRrepurchase,
		OrderScreenshotURL: "https://example.com/after-approval.png",
		InjectionColorNote: "blue",
		ShippingAddress:    "changed after approval",
	}); err == nil {
		t.Fatal("approved submission was unexpectedly editable")
	}
}

func TestPromoApplicantCannotChangeCampaignOrReadAnotherUsersSubmission(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "json")
	repo, err := NewPromoRepo(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewPromoService(repo, "test-jwt-secret")
	if _, err := service.Submit("SN-OWNER", PromoSubmissionInput{
		CampaignID:         PromoCampaignCNCRrepurchase,
		OrderScreenshotURL: "https://example.com/order.png",
		InjectionColorNote: "white",
		ShippingAddress:    "address",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.GetMySubmission("SN-OTHER"); err == nil {
		t.Fatal("another user unexpectedly read the submission")
	}
	if _, err := service.UpdateSubmission("SN-OWNER", PromoSubmissionInput{
		CampaignID:         PromoCampaignVideoLikeFreeOrder,
		OrderNo:            "ORDER",
		OrderScreenshotURL: "https://example.com/order.png",
		VideoLink:          "https://example.com/video",
		PaymentQrURL:       "https://example.com/qr.png",
	}); err == nil {
		t.Fatal("campaign was unexpectedly changeable")
	}
}
