// SectionHeatmap.jsx — improved with modern UI
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from 'chart.js';
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

export default function SectionHeatmap({ sectionScores }) {
  if (!sectionScores || !Object.keys(sectionScores).length) return null;

  const entries = Object.entries(sectionScores).sort((a,b) => b[1]-a[1]);
  const labels  = entries.map(([k]) => k);
  const values  = entries.map(([,v]) => v);

  const bgColors = values.map(v =>
    v > 50 ? 'rgba(239,68,68,0.8)' : v > 20 ? 'rgba(245,158,11,0.8)' : 'rgba(52,211,153,0.8)'
  );

  return (
    <div style={{
      background: "rgba(17,24,39,0.6)",
      border: "1px solid rgba(31,41,55,0.8)",
      borderRadius: 16,
      padding: "18px 20px",
      marginBottom: 16,
      backdropFilter: "blur(10px)",
      transition: "all 0.3s ease"
    }}>
      <div style={{
        fontFamily: "'Inter', sans-serif",
        fontSize: 12,
        fontWeight: 700,
        color: "#e8eaf0",
        letterSpacing: "0.02em",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        gap: 8
      }}>
        <span style={{ fontSize: 16 }}>📊</span>
        Section Breakdown
      </div>

      {/* Bar chart */}
      <div style={{ height: entries.length * 32 + 20 }}>
        <Bar
          data={{
            labels,
            datasets: [{
              data: values,
              backgroundColor: bgColors,
              borderRadius: 6,
              borderSkipped: false,
              borderColor: "transparent"
            }]
          }}
          options={{
            indexAxis: "y",
            maintainAspectRatio: false,
            scales: {
              x: {
                min: 0,
                max: 100,
                ticks: {
                  callback: v => v + '%',
                  color: "#6b7280",
                  font: { family: "'Inter', sans-serif", size: 9 }
                },
                grid: { color: "rgba(31,41,55,0.3)" },
                border: { color: "rgba(31,41,55,0.3)" }
              },
              y: {
                ticks: {
                  color: "#9ca3af",
                  font: { family: "'Inter', sans-serif", size: 11, weight: 500 }
                },
                grid: { display: false },
                border: { display: false }
              },
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: c => `${c.raw}% plagiarism`
                },
                backgroundColor: "rgba(10,14,26,0.9)",
                titleColor: "#f9fafb",
                bodyColor: "#9ca3af",
                borderColor: "rgba(31,41,55,0.8)",
                borderWidth: 1,
                padding: 10,
                titleFont: { family: "'Inter', sans-serif", size: 12, weight: 600 },
                bodyFont: { family: "'Inter', sans-serif", size: 11 }
              }
            },
          }}
        />
      </div>

      {/* Legend */}
      <div style={{
        display: "flex",
        gap: 16,
        marginTop: 14,
        flexWrap: "wrap",
        paddingTop: 12,
        borderTop: "1px solid rgba(31,41,55,0.5)"
      }}>
        {[
          { color: "#ef4444", label: ">50% High Risk" },
          { color: "#f59e0b", label: "20–50% Caution" },
          { color: "#34d399", label: "<20% Safe" }
        ].map(({ color, label }) => (
          <div key={label} style={{
            display: "flex",
            alignItems: "center",
            gap: 8
          }}>
            <div style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: color,
              boxShadow: `0 0 8px ${color}40`
            }} />
            <span style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 11,
              color: "#9ca3af",
              fontWeight: 500
            }}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
