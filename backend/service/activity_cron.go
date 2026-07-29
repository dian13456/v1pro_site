package service

import (
	"log"
	"time"
)

type ActivityCron struct {
	service *ActivityService
	stop    chan struct{}
}

func NewActivityCron(service *ActivityService) *ActivityCron {
	return &ActivityCron{service: service, stop: make(chan struct{})}
}

func (c *ActivityCron) Start() {
	if c == nil || c.service == nil {
		return
	}
	go c.loop()
}

func (c *ActivityCron) Stop() {
	if c == nil {
		return
	}
	select {
	case <-c.stop:
	default:
		close(c.stop)
	}
}

func (c *ActivityCron) loop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-c.stop:
			return
		case now := <-ticker.C:
			c.tick(now)
		}
	}
}

func (c *ActivityCron) tick(now time.Time) {
	activity, ok, err := c.service.repo.GetActiveActivity()
	if err != nil {
		log.Printf("[activity-cron] load activity failed: %v", err)
		return
	}
	if !ok {
		return
	}
	if now.Hour() != activity.DrawHour || now.Minute() != activity.DrawMinute {
		return
	}
	period := DrawPeriodKey(now)
	drawn, err := c.service.repo.HasDrawnPeriod(activity.ID, period)
	if err != nil {
		log.Printf("[activity-cron] check draw log failed: %v", err)
		return
	}
	if drawn {
		return
	}
	result, err := c.service.DrawForPeriod(activity.ID, period, false)
	if err != nil {
		log.Printf("[activity-cron] draw failed activity=%s period=%s err=%v", activity.ID, period, err)
		return
	}
	log.Printf("[activity-cron] draw completed activity=%s period=%s winners=%d joins=%d", result.ActivityID, result.DrawPeriod, result.WinnerCount, result.JoinCount)
}
