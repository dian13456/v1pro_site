package service

import "testing"

func TestClosedPromosRejectNewApplicationsAndKeepAdminReview(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "json")
	t.Setenv("PROMO_REGISTRATION_CLOSED", "false")
	repo, err := NewPromoRepo(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = repo.Close() })
	svc := NewPromoService(repo, "test-jwt-secret")
	input := PromoSubmissionInput{CampaignID: PromoCampaignVideoLikeFreeOrder, OrderNo: "OLD-ORDER", OrderScreenshotURL: "https://example.com/order.jpg", VideoLink: "https://example.com/video", PaymentQrURL: "https://example.com/qr.jpg"}
	created, err := svc.Submit("EXISTING-USER", input)
	if err != nil {
		t.Fatal(err)
	}
	// With no explicit override, both campaigns are now closed.
	t.Setenv("PROMO_REGISTRATION_CLOSED", "")
	overview, err := svc.GetOverview("EXISTING-USER")
	if err != nil {
		t.Fatal(err)
	}
	if overview.Current == nil || overview.Current.ID != created.ID {
		t.Fatal("existing application disappeared")
	}
	for _, campaign := range overview.Campaigns {
		if campaign.Status != ActivityStatusEnded {
			t.Fatalf("campaign %s remains open", campaign.ID)
		}
		input.CampaignID = campaign.ID
		if _, err := svc.Submit("NEW-USER", input); err == nil {
			t.Fatalf("closed campaign %s accepted application", campaign.ID)
		}
	}
	if _, err := svc.ReviewSubmission(created.ID, PromoStatusApproved, "review after closing"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdatePaymentProofURL(created.ID, "https://example.com/proof.jpg"); err != nil {
		t.Fatal(err)
	}
}

func TestPromoApplicantCanViewAndCorrectSubmissionBeforeApproval(t *testing.T) {
	t.Setenv("PROMO_REGISTRATION_CLOSED", "false")
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
	t.Setenv("PROMO_REGISTRATION_CLOSED", "false")
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
