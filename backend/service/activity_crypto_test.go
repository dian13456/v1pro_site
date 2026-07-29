package service

import "testing"

func TestValidateSNFormat(t *testing.T) {
	if !ValidateSNFormat("ABC123456") {
		t.Fatal("expected valid SN")
	}
	if ValidateSNFormat("abc") {
		t.Fatal("expected invalid short SN")
	}
	if ValidateSNFormat("ab") {
		t.Fatal("expected invalid short SN after normalize")
	}
}

func TestEncryptDecryptActivityField(t *testing.T) {
	secret := "test-secret-key"
	plain := "13800138000"
	enc, err := EncryptActivityField(secret, plain)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}
	if enc == plain {
		t.Fatal("encrypted value should differ")
	}
	dec, err := DecryptActivityField(secret, enc)
	if err != nil {
		t.Fatalf("decrypt failed: %v", err)
	}
	if dec != plain {
		t.Fatalf("expected %q got %q", plain, dec)
	}
}

func TestValidateChinaMobilePhone(t *testing.T) {
	if !ValidateChinaMobilePhone("13800138000") {
		t.Fatal("expected valid phone")
	}
	if ValidateChinaMobilePhone("23800138000") {
		t.Fatal("expected invalid phone")
	}
}
